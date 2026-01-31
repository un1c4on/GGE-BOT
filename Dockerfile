FROM node:18-alpine

# Çalışma dizinini oluştur
WORKDIR /usr/src/app

# Bağımlılıkları kopyala ve yükle
COPY package*.json ./
RUN npm install

# Frontend (Website) bağımlılıklarını yükle ve build al
COPY website/package*.json ./website/
RUN cd website && npm install

# Kaynak kodları kopyala
COPY . .

# Frontend'i derle
RUN cd website && npm run build

# Uygulamanın çalışacağı port
EXPOSE 3002

# Başlatma komutu
CMD [ "npm", "start" ]
