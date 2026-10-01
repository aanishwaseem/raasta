# Dev/reference image: keeps devDependencies so `npm run db:seed` works inside the container.
# For production, prune with `npm prune --omit=dev` after the build step.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=development
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY package*.json tsconfig*.json ./
COPY src ./src
RUN mkdir -p /app/storage && chown -R node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
