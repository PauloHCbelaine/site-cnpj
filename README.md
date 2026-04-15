# Radar de Dominio e CNPJ

Aplicacao estatica em HTML, CSS e JavaScript para investigar um dominio e reunir tres tipos de informacao:

- registros MX por DNS-over-HTTPS
- possiveis CNPJs publicados nas paginas institucionais do site
- sinais gerais da empresa, como nome da organizacao e trechos institucionais

## Como usar

1. Abra o arquivo `index.html` em um navegador moderno.
2. Digite um dominio, como `empresa.com.br`.
3. Veja os resultados divididos em resumo, MX, possiveis CNPJs e pistas do site.

## Como funciona

- MX: consulta `https://dns.google/resolve` com tipo `MX`.
- Conteudo do site: tenta ler a pagina principal e caminhos comuns como `/contato`, `/sobre` e `/empresa`.
- CNPJ: aplica regex para localizar formatos de CNPJ no texto retornado.
- Empresa: tenta inferir organizacao via JSON-LD, copyright e trechos institucionais.
- Enriquecimento: se um CNPJ de 14 digitos for localizado, tenta consultar a `BrasilAPI`.

## Limitacoes importantes

- Dominio para CNPJ nao e um mapeamento publico garantido. O app trabalha com evidencias publicas do proprio site.
- Nem todo site publica CNPJ em HTML visivel.
- A leitura remota de conteudo depende de um proxy de texto (`r.jina.ai`). Se ele falhar, a parte de pistas/CNPJ pode ficar vazia.
- A heuristica atual para dominio principal e simples. Em casos como subdominios complexos (`algo.empresa.com.br`), pode ser interessante integrar uma lista de sufixos publicos no futuro.

## Proximos passos sugeridos

- adicionar validacao oficial de CNPJ
- integrar consulta RDAP/WHOIS onde houver dados publicos
- permitir exportar relatorio em JSON ou CSV
- criar backend proprio para reduzir dependencia de proxies externos teste1