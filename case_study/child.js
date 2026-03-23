process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  const lines = chunk.split(/\r?\n/).filter((l) => l.length > 0);
  for (const line of lines) {
    process.stdout.write(`child got: ${line}\n`);
    process.stderr.write(`child err: ${line}\n`);
  }
});

process.stdin.on('end', () => {
  process.stdout.write('child stdin closed\n');