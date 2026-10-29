import 'reflect-metadata';
import {DataSource} from 'typeorm';

import {Epoch1790850000003} from './migrations/epoch';
import {Initial1790850000000} from './migrations/initial';
import {Ledger1790850000002} from './migrations/ledger';
import {RetiredSetFlags1790850000004} from './migrations/retired-set-flags';
import {Sync1790850000001} from './migrations/sync';

export function database(url: string) {
	return new DataSource({
		type: 'postgres',
		url,
		synchronize: false,
		logging: false,
		migrations: [
			Initial1790850000000,
			Sync1790850000001,
			Ledger1790850000002,
			Epoch1790850000003,
			RetiredSetFlags1790850000004,
		],
	});
}
