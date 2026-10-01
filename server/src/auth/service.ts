import {ForbiddenException, HttpException, UnauthorizedException} from '@nestjs/common';
import * as argon2 from 'argon2';
import {Request, Response} from 'express';
import {createHash, randomBytes} from 'node:crypto';
import {DataSource} from 'typeorm';

import {Config} from '../config';

interface Session {
	token_hash: string;
	owner_id: string;
	csrf: string;
	expires_at: Date;
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export class AuthService {
	private attempts = 0;
	private windowStart = Date.now();
	constructor(
		private db: DataSource,
		private cfg: Config,
	) {}
	private requireTailscaleOwner(req: Request) {
		if (
			this.cfg.authMode === 'tailscale' &&
			(!this.cfg.tailscaleUserLogin || req.headers['tailscale-user-login'] !== this.cfg.tailscaleUserLogin)
		)
			throw new UnauthorizedException('Invalid credentials');
	}
	async session(req: Request): Promise<Session> {
		this.requireTailscaleOwner(req);
		const token = req.headers.cookie
			?.split(';')
			.map((s) => s.trim())
			.find((s) => s.startsWith('gym_log_session='))
			?.slice(16);
		const rows: Session[] = token
			? await this.db.query('SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now()', [digest(token)])
			: [];
		if (!rows.length) throw new UnauthorizedException();
		return rows[0];
	}
	async mutation(req: Request) {
		const s = await this.session(req);
		if (req.headers['x-csrf-token'] !== s.csrf) throw new ForbiddenException();
		return s;
	}
	async login(req: Request, body: unknown, res: Response) {
		this.requireTailscaleOwner(req);
		if (this.cfg.authMode !== 'tailscale') {
			if (Date.now() - this.windowStart >= 60000) {
				this.attempts = 0;
				this.windowStart = Date.now();
			}
			if (this.attempts++ >= 5) throw new HttpException('Try again later', 429);
			const password = body && typeof body === 'object' && 'password' in body ? body.password : undefined;
			if (typeof password !== 'string' || !this.cfg.hash || !(await argon2.verify(this.cfg.hash, password)))
				throw new UnauthorizedException('Invalid credentials');
		}
		const token = randomBytes(32).toString('hex'),
			csrf = randomBytes(32).toString('hex');
		await this.db.query("INSERT INTO sessions VALUES ($1,'owner',$2,now()+($3 * interval '1 second'))", [
			digest(token),
			csrf,
			this.cfg.ttl,
		]);
		res.cookie('gym_log_session', token, {
			httpOnly: true,
			sameSite: 'strict',
			secure: this.cfg.secure,
			path: '/api/v1',
			maxAge: this.cfg.ttl * 1000,
		});
		return {ownerId: 'owner', csrfToken: csrf};
	}
	async logout(req: Request, res: Response) {
		const s = await this.mutation(req);
		await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [s.token_hash]);
		res.clearCookie('gym_log_session', {
			httpOnly: true,
			sameSite: 'strict',
			secure: this.cfg.secure,
			path: '/api/v1',
		});
		return {loggedOut: true};
	}
}
