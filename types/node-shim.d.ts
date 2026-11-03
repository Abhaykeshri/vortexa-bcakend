declare module 'node:test' { const test: (name: string, fn: () => void | Promise<void>) => void; export default test; }
declare module 'node:assert/strict' { const assert: { equal(a: unknown,b: unknown): void; throws(fn:()=>unknown,error?:unknown):void; rejects(fn:()=>Promise<unknown>, error?:unknown):Promise<void> }; export default assert; }

declare module 'node:fs' { export function existsSync(path: string): boolean; export function readFileSync(path: string, encoding: string): string; }
declare module 'node:http' { export function createServer(handler: (req: any, res: any) => void | Promise<void>): {requestTimeout:number;headersTimeout:number;listen(port:number,host:string,callback:()=>void):void}; }
declare const process: { env: Record<string,string|undefined> };
