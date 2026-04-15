# 🚀 Guia de Deploy e Integração

Instruções para integrar e fazer deploy da solução de extração de CNPJ em diferentes ambientes.

## 📋 Pré-requisitos

- Node.js >= 16.0.0
- NPM ou Yarn
- Chave da API Google Gemini (para IA, opcional)

## 🔧 Instalação Completa

### 1. Clonar/Copiar Arquivos

```bash
# Copiar para seu projeto
cp extract-cnpj.js seu-projeto/
cp server-extract-cnpj.js seu-projeto/
cp example-extract-cnpj.js seu-projeto/
```

### 2. Instalar Dependências

```bash
cd seu-projeto

# Instalar dependências core
npm install axios cheerio dotenv

# Instalar para IA (opcional)
npm install @google/generative-ai

# Instalar para servidor (opcional)
npm install express cors morgan express-rate-limit
```

### 3. Obter Chave da API Gemini

```bash
# Ir em: https://aistudio.google.com/app/apikey
# Copiar sua chave e adicionar ao .env
```

## 📝 Arquivo .env

### Exemplo Mínimo (Apenas Scraping)

```env
NODE_ENV=production
PORT=3000
```

### Exemplo Completo (Com IA)

```env
# Ambiente
NODE_ENV=production
PORT=3000

# API Gemini
GEMINI_API_KEY=sua-chave-super-secreta-aqui

# Configurações de Extração
TIMEOUT=15000
MAX_RETRIES=3
USE_AI=true

# CORS
CORS_ORIGIN=https://seu-dominio.com.br

# Rate Limiting
RATE_LIMIT=100
BATCH_LIMIT=10

# Logging
LOG_LEVEL=info
```

## 🧪 Executar Testes

### Teste de Unidade

```bash
node tests-extract-cnpj.js

# Esperado:
# ✓ 100+ testes passaram
# Taxa de sucesso: 100%
```

### Teste Manual

```bash
# Criar arquivo test-manual.js
cat > test-manual.js << 'EOF'
import CNPJExtractor from './extract-cnpj.js';

const extractor = new CNPJExtractor({ useAI: false });
const result = await extractor.extract('https://www.google.com.br');
console.log(result);
EOF

node test-manual.js
```

## 🌐 Opções de Deploy

### Opção 1: Servidor Standalone (Local/VPS)

```bash
# 1. SSH na máquina
ssh usuario@seu-servidor.com

# 2. Clonar projeto
git clone seu-projeto.git
cd seu-projeto

# 3. Instalar dependências
npm install

# 4. Configurar .env
nano .env
# Adicionar variáveis

# 5. Iniciar com PM2 (recomendado)
npm install -g pm2
pm2 start server-extract-cnpj.js --name "cnpj-extractor"
pm2 save

# 6. Configurar como serviço
pm2 startup
```

### Opção 2: Docker

#### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Instalar dependências
COPY package*.json ./
RUN npm install --production

# Copiar código
COPY extract-cnpj.js .
COPY server-extract-cnpj.js .

# Expor porta
EXPOSE 3000

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000

# Iniciar servidor
CMD ["node", "server-extract-cnpj.js"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  cnpj-extractor:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - TIMEOUT=15000
      - MAX_RETRIES=3
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

#### Build e Execute

```bash
# Build da imagem
docker build -t cnpj-extractor .

# Executar container
docker run -p 3000:3000 \
  -e GEMINI_API_KEY="sua-chave" \
  cnpj-extractor

# Com docker-compose
docker-compose up -d
```

### Opção 3: Vercel/Netlify (Serverless)

#### Estrutura de Projeto

```
.
├── api/
│   └── extract.js
├── package.json
└── vercel.json
```

#### api/extract.js

```javascript
import CNPJExtractor from '../extract-cnpj.js';

const extractor = new CNPJExtractor({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;
    const result = await extractor.extract(url);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
```

#### vercel.json

```json
{
  "buildCommand": "npm install",
  "functions": {
    "api/*.js": {
      "memory": 1024,
      "maxDuration": 30
    }
  }
}
```

#### Deploy

```bash
npm install -g vercel
vercel --prod
```

### Opção 4: AWS Lambda

#### Estrutura

```
├── lambda_function.js
├── package.json
└── .env.local
```

#### lambda_function.js

```javascript
import CNPJExtractor from './extract-cnpj.js';

const extractor = new CNPJExtractor({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function handler(event, context) {
  try {
    const { url } = JSON.parse(event.body || '{}');
    const result = await extractor.extract(url);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
```

#### Deploy com SAM

```bash
sam build
sam deploy --guided
```

## 🔄 Integração em Aplicações Existentes

### Next.js/React

```javascript
// pages/api/cnpj.js
import CNPJExtractor from '../../lib/extract-cnpj.js';

const extractor = new CNPJExtractor({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  const { url } = req.body;
  const result = await extractor.extract(url);
  res.json(result);
}
```

### Django/Python (ASGI)

```python
# Usar o servidor Node.js como serviço separado
import requests

def extrair_cnpj(url):
    response = requests.post(
        'http://localhost:3000/api/extract-cnpj',
        json={'url': url}
    )
    return response.json()
```

### FastAPI/Python

```python
from fastapi import FastAPI
import httpx

app = FastAPI()

async def extrair_cnpj_batch(urls: list[str]):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            'http://localhost:3000/api/extract-cnpj/batch',
            json={'urls': urls}
        )
        return response.json()
```

## 🔒 Segurança em Produção

### 1. Variáveis de Ambiente

```bash
# Nunca commitar .env
echo ".env" >> .gitignore

# Usar secrets management
# - AWS Secrets Manager
# - Vercel Environment Variables
# - GitHub Secrets
```

### 2. Rate Limiting

```javascript
// Já configurado em server-extract-cnpj.js
// Adicionar reverseproxy rate limiting (nginx)

# /etc/nginx/sites-available/cnpj-extractor
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    listen 80;
    
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://localhost:3000;
    }
}
```

### 3. HTTPS/SSL

```bash
# Usar Let's Encrypt com Certbot
sudo certbot certonly --standalone -d seu-dominio.com.br

# Ou usar proxy reverso com SSL
```

### 4. Logging

```javascript
// Monitorar em produção
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Usar em vez de console.log
logger.info('Extração iniciada', { url, timestamp: Date.now() });
```

## 📊 Monitoramento

### Health Check

```bash
# Verificar status do servidor
curl http://localhost:3000/health

# Adicionar no cron para alertas
*/5 * * * * curl -f http://localhost:3000/health || \
  send_alert "CNPJ Extractor is down"
```

### Métricas

```javascript
// Implementar no seu servidor
import StatsD from 'node-statsd';

const client = new StatsD();

// Contador de requisições
client.increment('cnpj.requests');

// Tempo de processamento
const start = Date.now();
await extractor.extract(url);
client.timing('cnpj.duration', Date.now() - start);

// Taxa de sucesso
if (result.cnpj) {
  client.increment('cnpj.success');
} else {
  client.increment('cnpj.failed');
}
```

## 🐛 Debug

### Ativar Verbose Logging

```javascript
// No seu código
process.env.DEBUG = 'cnpj:*';

// Ou adicionar logging detalhado
const result = await extractor.extract(url);
console.log('Debug:', {
  url,
  result,
  cache_size: extractor.getCacheStats().size,
});
```

### Testar Conectividade

```bash
# Verificar acesso ao site
curl -I https://empresa.com.br

# Testar DNS
nslookup empresa.com.br

# Testar com verbose
curl -v https://empresa.com.br
```

## 📈 Performance em Produção

### Recomendações

1. **Cache Redis**
   - Persistente entre reinicializações
   - Compartilhado entre múltiplas instâncias

2. **Load Balancing**
   - Nginx/HAProxy
   - Round-robin entre múltiplas instâncias

3. **Queue de Processamento**
   - Bull/RabbitMQ para lotes grandes
   - Processar assincronamente

4. **CDN**
   - Cache de respostas frequentes

## ✅ Checklist de Deploy

- [ ] Testar localmente (`npm test`)
- [ ] Configurar `.env` com variáveis corretas
- [ ] Verificar conectividade de internet
- [ ] Testar requisição manual com curl
- [ ] Configurar logging
- [ ] Ativar monitoramento
- [ ] Testar com carga (load testing)
- [ ] Configurar backup/recuperação
- [ ] Documentar endpoints
- [ ] Treinar equipe
- [ ] Preparar runbook de troubleshooting

## 📞 Contato & Suporte

Para problemas de deploy, consulte:
- Documentação em `EXTRACT_CNPJ_GUIDE.md`
- Exemplos em `example-extract-cnpj.js`
- Logs da aplicação

---

**Deploy seguro e confiável** 🚀
