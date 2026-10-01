import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {localCsvMiddleware} from '../scripts/local-csv';
it('serves only the explicitly configured private CSV at one local dev route without caching',async()=>{
 const dir=await mkdtemp(join(process.env.TMPDIR??process.cwd(),'gym-csv-'));
 try {
  const file=join(dir,'synthetic.csv'); await writeFile(file,'synthetic;fixture');
  let body=''; const headers:Record<string,string>={}; let continued=false;
  const res={statusCode:200,setHeader:(key:string,value:string)=>{headers[key]=value;},end:(value:string)=>{body=value;}} as unknown as ServerResponse;
  await localCsvMiddleware(file)({url:'/__local/strong.csv',method:'GET'} as IncomingMessage,res,()=>{continued=true;});
  expect(body).toBe('synthetic;fixture'); expect(continued).toBe(false); expect(headers['Cache-Control']).toBe('no-store');
  body=''; continued=false;
  await localCsvMiddleware(file)({url:'/__local/other.csv',method:'GET'} as IncomingMessage,res,()=>{continued=true;});
  expect(continued).toBe(true); expect(body).toBe('');
  body='';
  await localCsvMiddleware(undefined)({url:'/__local/strong.csv',method:'GET'} as IncomingMessage,res,()=>{});
  expect(res.statusCode).toBe(404); expect(body).not.toContain('synthetic;fixture');
 } finally {await rm(dir,{recursive:true,force:true});}
});
