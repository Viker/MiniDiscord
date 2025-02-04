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

# Create production stage
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install serve package globally
RUN npm install -g serve

# Copy built files from builder stage
COPY --from=builder /app/dist/bundle.js ./public/
COPY src/index.html ./public/
COPY src/styles.css ./public/

# Expose port 3000
EXPOSE 3000

# Start static file server
CMD ["serve", "-s", "public", "-l", "3000"]
