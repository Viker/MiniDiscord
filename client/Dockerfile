# Build stage
FROM node:18-alpine as builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY webpack.config.js ./

# Install dependencies
RUN npm install

# Copy source files
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/dist/bundle.js /usr/share/nginx/html/
COPY src/index.html /usr/share/nginx/html/
COPY src/styles.css /usr/share/nginx/html/

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
