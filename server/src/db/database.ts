import 'reflect-metadata';
import {DataSource} from 'typeorm';

import {Initial1790850000000} from './migrations/initial';
import {Ledger1790850000002} from './migrations/ledger';
import {Sync1790850000001} from './migrations/sync';

export function database(url: string) {
	return new DataSource({
		type: 'postgres',
		url,
		synchronize: false,
		logging: false,
		migrations: [Initial1790850000000, Sync1790850000001, Ledger1790850000002],
	});
}
