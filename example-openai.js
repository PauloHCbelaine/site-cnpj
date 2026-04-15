/**
 * Exemplos de uso da função extractCnpjFromUrl
 */

import { extractCnpjFromUrl, isValidCNPJ, normalizeCNPJExport } from './extract-cnpj-openai.js';

/**
 * Exemplo 1: Extrair CNPJ de uma URL
 */
async function example1() {
  console.log('='.repeat(60));
  console.log('EXEMPLO 1: Extrair CNPJ de uma URL');
  console.log('='.repeat(60));

  const url = 'https://www.google.com';
  const cnpj = await extractCnpjFromUrl(url);

  if (cnpj) {
    console.log(`Resultado: ${cnpj}`);
  } else {
    console.log('Resultado: Não encontrado');
  }
}

/**
 * Exemplo 2: Processar múltiplas URLs
 */
async function example2() {
  console.log('\n' + '='.repeat(60));
  console.log('EXEMPLO 2: Processar múltiplas URLs');
  console.log('='.repeat(60));

  const urls = [
    'https://www.empresa1.com.br',
    'https://www.empresa2.com.br',
    'https://www.empresa3.com.br',
  ];

  const results = [];

  for (const url of urls) {
    const cnpj = await extractCnpjFromUrl(url);
    results.push({ url, cnpj: cnpj || 'Não encontrado' });
    
    // Aguardar 2 segundos entre requisições para evitar rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\nResultados:');
  results.forEach(r => {
    console.log(`  ${r.url} -> ${r.cnpj}`);
  });

  return results;
}

/**
 * Exemplo 3: Validar CNPJ
 */
async function example3() {
  console.log('\n' + '='.repeat(60));
  console.log('EXEMPLO 3: Validar CNPJs');
  console.log('='.repeat(60));

  const cnpjs = [
    '34.028.316/0001-86', // Válido
    '34.028.316/0001-87', // Inválido (checksum errado)
    '11.222.333/0001-81', // Inválido (sequência repetida)
    '12345678/0001-81',   // Inválido (comprimento errado)
  ];

  cnpjs.forEach(cnpj => {
    const isValid = isValidCNPJ(cnpj);
    console.log(`${cnpj}: ${isValid ? '✅ Válido' : '❌ Inválido'}`);
  });
}

/**
 * Exemplo 4: Normalizar CNPJ
 */
async function example4() {
  console.log('\n' + '='.repeat(60));
  console.log('EXEMPLO 4: Normalizar CNPJs');
  console.log('='.repeat(60));

  const cnpjs = [
    '34.028.316/0001-86',
    '34028316000186',
    '34 028 316 0001 86',
    '34-028-316/0001-86',
  ];

  cnpjs.forEach(cnpj => {
    const normalized = normalizeCNPJExport(cnpj);
    console.log(`${cnpj} -> ${normalized || 'Inválido'}`);
  });
}

/**
 * Exemplo 5: Tratamento de erros
 */
async function example5() {
  console.log('\n' + '='.repeat(60));
  console.log('EXEMPLO 5: Tratamento de erros');
  console.log('='.repeat(60));

  const invalidUrls = [
    'não-é-uma-url',
    'http://localhost:9999',
    'https://dominio-inexistente-xyzabc.com',
  ];

  for (const url of invalidUrls) {
    try {
      console.log(`\nTentando: ${url}`);
      const cnpj = await extractCnpjFromUrl(url);
      console.log(`Resultado: ${cnpj || 'Não encontrado'}`);
    } catch (error) {
      console.log(`Erro: ${error.message}`);
    }
  }
}

/**
 * Executar exemplos
 */
async function runExamples() {
  try {
    // Executar exemplos 1-5
    await example1();
    await example2();
    await example3();
    await example4();
    await example5();

    console.log('\n' + '='.repeat(60));
    console.log('✅ Todos os exemplos executados!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Erro ao executar exemplos:', error);
  }
}

// Executar
runExamples();
