FROM node:24-alpine

RUN apk add --no-cache openssl

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run prisma:generate --workspace=@le-grand-cinema/api \
    && npm run build --workspace=@le-grand-cinema/api

EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace=@le-grand-cinema/api"]
