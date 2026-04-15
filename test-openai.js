/**
 * Testes unitários para a função de extração de CNPJ
 */

import { isValidCNPJ, normalizeCNPJExport } from './extract-cnpj-openai.js';

// Cores para output no terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Suite de testes
 */
const testSuites = [
  {
    name: 'Validação de CNPJ',
    tests: [
      {
        description: 'CNPJ válido (34.028.316/0001-86)',
        value: '34.028.316/0001-86',
        expected: true,
      },
      {
        description: 'CNPJ válido sem formatação (34028316000186)',
        value: '34028316000186',
        expected: true,
      },
      {
        description: 'CNPJ inválido - checksum errado',
        value: '34.028.316/0001-87',
        expected: false,
      },
      {
        description: 'CNPJ inválido - números repetidos',
        value: '11.111.111/1111-11',
        expected: false,
      },
      {
        description: 'CNPJ inválido - comprimento errado',
        value: '34.028.316/0001',
        expected: false,
      },
      {
        description: 'CNPJ nulo',
        value: null,
        expected: false,
      },
    ],
  },
  {
    name: 'Normalização de CNPJ',
    tests: [
      {
        description: 'Normalizar com formatação',
        value: '34.028.316/0001-86',
        expected: '34.028.316/0001-86',
        fn: 'normalize',
      },
      {
        description: 'Normalizar sem formatação',
        value: '34028316000186',
        expected: '34.028.316/0001-86',
        fn: 'normalize',
      },
      {
        description: 'Normalizar com espaços',
        value: '34 028 316 0001 86',
        expected: '34.028.316/0001-86',
        fn: 'normalize',
      },
      {
        description: 'Normalizar com travessão',
        value: '34-028-316-0001-86',
        expected: '34.028.316/0001-86',
        fn: 'normalize',
      },
      {
        description: 'Normalizar CNPJ inválido',
        value: '12345678901234',
        expected: null,
        fn: 'normalize',
      },
    ],
  },
  {
    name: 'CNPJs conhecidos válidos',
    tests: [
      {
        description: 'Google Brasil (34.028.316/0001-86)',
        value: '34.028.316/0001-86',
        expected: true,
      },
      {
        description: 'Microsoft Brasil (61.150.996/0001-81)',
        value: '61.150.996/0001-81',
        expected: true,
      },
      {
        description: 'Amazon Brasil (32.208.659/0001-80)',
        value: '32.208.659/0001-80',
        expected: true,
      },
    ],
  },
];

/**
 * Função para executar testes
 */
function runTests() {
  console.log(`\n${colors.blue}${'='.repeat(60)}`);
  console.log('TESTES DE VALIDAÇÃO DE CNPJ');
  console.log(`${'='.repeat(60)}${colors.reset}\n`);

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  testSuites.forEach((suite) => {
    console.log(`${colors.blue}📋 ${suite.name}${colors.reset}`);
    console.log('-'.repeat(60));

    suite.tests.forEach((test) => {
      totalTests++;
      let result;
      let passed;

      try {
        if (test.fn === 'normalize') {
          result = normalizeCNPJExport(test.value);
          passed = result === test.expected;
        } else {
          result = isValidCNPJ(test.value);
          passed = result === test.expected;
        }

        if (passed) {
          console.log(`${colors.green}✓${colors.reset} ${test.description}`);
          console.log(
            `  Input: ${JSON.stringify(test.value)} → Output: ${JSON.stringify(result)}`
          );
          passedTests++;
        } else {
          console.log(`${colors.red}✗${colors.reset} ${test.description}`);
          console.log(
            `  Input: ${JSON.stringify(test.value)}`
          );
          console.log(
            `  Esperado: ${JSON.stringify(test.expected)}`
          );
          console.log(
            `  Obtido: ${JSON.stringify(result)}`
          );
          failedTests++;
        }
      } catch (error) {
        console.log(`${colors.red}✗${colors.reset} ${test.description} (ERRO)`);
        console.log(`  Erro: ${error.message}`);
        failedTests++;
      }

      console.log('');
    });
  });

  console.log(`${colors.blue}${'='.repeat(60)}`);
  console.log('RESUMO DOS TESTES');
  console.log(`${'='.repeat(60)}${colors.reset}`);
  console.log(`Total: ${totalTests}`);
  console.log(`${colors.green}Passou: ${passedTests}${colors.reset}`);
  console.log(`${colors.red}Falhou: ${failedTests}${colors.reset}`);
  console.log(
    `Taxa de sucesso: ${colors.blue}${((passedTests / totalTests) * 100).toFixed(1)}%${colors.reset}`
  );
  console.log('');

  return failedTests === 0;
}

// Executar testes
const allPassed = runTests();
process.exit(allPassed ? 0 : 1);
