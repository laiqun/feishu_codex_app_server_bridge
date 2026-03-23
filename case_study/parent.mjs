import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outPath = path.resolve('child-output.log');
const errPath = path.resolve('child-error.log');

const child = spawn(process.execPath, [path.resolve('child.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

const outStream = fs.createWriteStream(outPath, { flags: 'w' });
const errStream = fs.createWriteStream(errPath, { flags: 'w' });

child.stdout.pipe(outStream);
child.stderr.pipe(errStream);

child.on('exit', (code) => {
  console.log(`child exit: ${code}`);
  console.log(`stdout saved to: ${outPath}`);
  console.log(`stderr saved to: ${errPath}`);
});

child.stdin.write('hello\n');
child.stdin.write('world\n');
child.stdin.end();
