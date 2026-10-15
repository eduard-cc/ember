import {Body, Controller, Delete, Get, Module, Post, Query, Req, Res} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {Request, Response} from 'express';
import 'reflect-metadata';

import {AuthService} from './auth/service';
import {config} from './config';
import {database} from './db/database';
import {currentEpoch} from './sync/reset';
import {SyncService} from './sync/service';

export async function createApp() {
	const cfg = config();
	const db = await database(cfg.url).initialize();
	try {
		await db.runMigrations();
	} catch (error) {
		await db.destroy();
		throw error;
	}
	const auth = new AuthService(db, cfg),
		sync = new SyncService(db);
	@Controller('/api/v1')
	class Api {
		@Get('health') async health() {
			await db.query('SELECT 1');
			return {status: 'ready'};
		}
		@Post('session') async login(
			@Req() req: Request,
			@Body() body: unknown,
			@Res({passthrough: true}) res: Response,
		) {
			const session = await auth.login(req, body, res);
			return {...session, epoch: await currentEpoch(db, session.ownerId)};
		}
		@Delete('session') logout(@Req() req: Request, @Res({passthrough: true}) res: Response) {
			return auth.logout(req, res);
		}
		@Get('session') async current(@Req() req: Request) {
			const s = await auth.session(req);
			return {ownerId: s.owner_id, csrfToken: s.csrf, epoch: await currentEpoch(db, s.owner_id)};
		}
		@Post('sync/operations') async operations(@Req() req: Request, @Body() body: unknown) {
			const s = await auth.mutation(req);
			return sync.operations(s.owner_id, body, req.headers['x-dataset-epoch']);
		}
		@Get('sync/changes') async changes(
			@Req() req: Request,
			@Query('after') after: string,
			@Query('limit') limit: string,
		) {
			const s = await auth.session(req);
			return sync.changes(
				s.owner_id,
				after,
				limit,
				req.headers['x-dataset-epoch'],
				req.headers['x-sync-body-weight'] === '1',
				req.headers['x-sync-workout-deletes'] === '1',
			);
		}
	}
	@Module({controllers: [Api]})
	class AppModule {}
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {logger: false, bodyParser: false});
	app.getHttpAdapter().getInstance().disable('x-powered-by');
	app.use((req: Request, res: Response, next: () => void) => {
		res.setHeader('Cache-Control', 'no-store');
		if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== cfg.origin) {
			res.status(403).json({errorCode: 'INVALID_ORIGIN'});
			return;
		}
		next();
	});
	app.useBodyParser('json', {limit: 10 * 1024 * 1024});
	const close = app.close.bind(app);
	app.close = async () => {
		try {
			await close();
		} finally {
			await db.destroy();
		}
	};
	return app;
}
