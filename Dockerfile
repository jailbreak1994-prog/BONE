FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "src/server.js"]
