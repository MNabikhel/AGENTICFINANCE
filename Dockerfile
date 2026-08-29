FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY schemas ./schemas
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile
ENV AETHER_HOSTED=true
ENV AETHER_DATA_DIR=/data
ENV PORT=8787
VOLUME ["/data"]
EXPOSE 8787
CMD ["pnpm", "dev"]
