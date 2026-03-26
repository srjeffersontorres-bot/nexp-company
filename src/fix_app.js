/**
 * INSTRUÇÕES / INSTRUCTIONS:
 * 1. Coloque este arquivo na pasta raiz do projeto (nexp-company/)
 * 2. Abra o PowerShell na pasta do projeto
 * 3. Execute: node fix_app.js
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'App.jsx');

if (!fs.existsSync(filePath)) {
  console.error('ERRO: src/App.jsx não encontrado.');
  console.error('Execute este script na pasta raiz do projeto (onde fica a pasta src/)');
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');
const linesBefore = content.split('\n').length;

// Show line 5101 before fix
const linesBefore5101 = content.split('\n')[5100];
console.log('Linha 5101 ANTES:', JSON.stringify(linesBefore5101?.substring(0, 100)));

// THE FIX: replace double-escaped newlines \\n with proper \n
// This was introduced by a previous fix session
let fixed = content;
let count = 0;

// Fix double-escaped newlines inside template literal strings
const matches = fixed.match(/\\\\n/g);
if (matches) {
  count = matches.length;
  fixed = fixed.replace(/\\\\n/g, '\\n');
}

// Fix 2: Find any literal newlines inside double-quoted strings
// These show as line breaks within a "..." string
const fixedLines = [];
const rawLines = fixed.split('\n');
let i = 0;
while (i < rawLines.length) {
  let line = rawLines[i];
  // Count unescaped double quotes (outside template literals)
  let dqCount = 0;
  let inTemplate = false;
  for (let j = 0; j < line.length; j++) {
    if (line[j] === '`') inTemplate = !inTemplate;
    if (!inTemplate && line[j] === '"' && (j === 0 || line[j-1] !== '\\')) dqCount++;
  }
  // If odd number of double quotes, the string continues on next line - merge
  if (!inTemplate && dqCount % 2 !== 0 && i + 1 < rawLines.length) {
    const merged = line + ' ' + rawLines[i+1].trim();
    fixedLines.push(merged);
    count++;
    i += 2;
  } else {
    fixedLines.push(line);
    i++;
  }
}
fixed = fixedLines.join('\n');

const linesAfter5101 = fixed.split('\n')[5100];
console.log('Linha 5101 DEPOIS:', JSON.stringify(linesAfter5101?.substring(0, 100)));

if (fixed === content) {
  console.log('\n✅ Arquivo está limpo - nenhum problema encontrado!');
  console.log('Se ainda der erro no build, tente deletar src/App.jsx e baixar novamente da conversa do Claude.');
} else {
  // Backup
  fs.writeFileSync(filePath + '.bak', content, 'utf8');
  fs.writeFileSync(filePath, fixed, 'utf8');
  console.log(`\n✅ Corrigido! ${count} problema(s) resolvido(s).`);
  console.log('Backup salvo em src/App.jsx.bak');
  console.log('\nAgora execute:');
  console.log('  git add src/App.jsx');
  console.log('  git commit -m "fix: corrige strings no App.jsx"');
  console.log('  git push');
}
