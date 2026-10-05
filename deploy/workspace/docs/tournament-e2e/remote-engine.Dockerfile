# Only the test driver imports this pure helper. Application images stay unchanged.
FROM node:24-bookworm-slim AS engine
ENV CI=true
RUN npm install --global pnpm@10.33.2
WORKDIR /app
COPY ["Backgammon Game/frontend/", "/app/"]
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN node --input-type=module -e "import { build } from 'vite'; await build({root:'/app',configFile:false,mode:'production',envDir:'/tmp',build:{outDir:'/output',emptyOutDir:true,lib:{entry:'/app/src/lib/backgammon/engine.ts',formats:['es'],fileName:()=> 'engine.js'}}})"
FROM scratch
COPY --from=engine /output/engine.js /engine.js
