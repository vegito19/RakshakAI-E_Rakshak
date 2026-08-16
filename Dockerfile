# Use Official Playwright image with pre-installed Chromium & system dependencies
FROM mcr.microsoft.com/playwright:v1.45.1-jammy

# Set working directory inside container
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies cleanly
RUN npm ci

# Copy full application source code
COPY . .

# Build TypeScript to dist/
RUN npm run build

# Expose default Hugging Face Spaces port (7860) and standard API port (5000)
EXPOSE 7860 5000

# Set default port to 7860 if not specified
ENV PORT=7860
ENV HOST=0.0.0.0

# Start Fastify server
CMD ["npm", "start"]
