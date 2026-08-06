FROM node:22-trixie-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.20.0 --activate

WORKDIR /app

COPY . .

ENV NODE_ENV=production
ENV CI=1

RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/openapi...

WORKDIR /app/packages/openapi

EXPOSE 4500

CMD ["pnpm", "start"]
