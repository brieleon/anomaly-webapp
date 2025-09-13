FROM python:3.10-slim

# Install system dependencies needed for Prophet, Matplotlib, and Redis
RUN apt-get update && apt-get install -y \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libpython3-dev \
    gcc \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Upgrade pip and install Python dependencies
RUN pip install --upgrade pip
RUN pip install -r requirements.txt

# Copy all your app source code
COPY . .

# Expose port 8082 as you mentioned
EXPOSE 8082

# Use exec form for CMD to avoid shell wrapping
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8082"]
