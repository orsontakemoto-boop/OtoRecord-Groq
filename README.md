
# OtoRecord - Guia de Publicação na Vercel

Siga estes passos para colocar seu aplicativo no ar:

### 1. Preparação do Código
Certifique-se de que todos os arquivos (incluindo o novo `package.json` e `vite.config.ts`) estão na raiz do seu repositório Git.

### 2. Subir para o GitHub
- Crie um repositório no GitHub.
- Faça o push do seu código:
  ```bash
  git init
  git add .
  git commit -m "Preparando para deploy"
  git remote add origin https://github.com/seu-usuario/otorecord.git
  git push -u origin main
  ```

### 3. Configuração na Vercel
1. Acesse [vercel.com](https://vercel.com) e faça login.
2. Clique em **"Add New"** > **"Project"**.
3. Importe o repositório que você acabou de criar.
4. Em **"Build & Development Settings"**, a Vercel deve detectar automaticamente o framework como **Vite**.
5. **IMPORTANTE (Variável de Ambiente)**:
   - Expanda a seção **"Environment Variables"**.
   - No campo `Key`, digite: `API_KEY`
   - No campo `Value`, cole sua chave da API do Google Gemini.
   - Clique em **"Add"**.
6. Clique em **"Deploy"**.

### 4. Verificação
Após o deploy, a Vercel fornecerá uma URL pública (ex: `otorecord.vercel.app`). Teste a gravação para garantir que a integração com o Gemini está funcionando corretamente.
