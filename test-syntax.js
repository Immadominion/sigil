const fs = require('fs');

try {
  require('@babel/parser').parse(fs.readFileSync('app/onboarding.tsx', 'utf8'), {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  console.log("Syntax is OK!");
} catch (e) {
  console.error(e.message);
}
