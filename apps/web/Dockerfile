FROM node:24-alpine

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=@le-grand-cinema/web", "--", "--host", "0.0.0.0"]
