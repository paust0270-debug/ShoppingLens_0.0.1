const { listen } = require('./share');

listen(process.argv[2]).then((url) => {
  process.stdout.write(`${JSON.stringify({ url })}\n`);
}).catch((e) => {
  process.stderr.write(String(e && e.message || e));
  process.exit(1);
});
