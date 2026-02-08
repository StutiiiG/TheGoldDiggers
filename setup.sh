#!/bin/bash

# AccessGuru - Simple Setup & Start Script

echo "🚀 Starting AccessGuru Backend..."
echo ""

# Step 1: Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python -m venv .venv
    echo "Virtual environment created"
else
    echo "Virtual environment exists"
fi

# Step 2: Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Step 3: Install requirements
echo "Installing dependencies..."
pip install -r requirements.txt

# Step 4: Start both servers
echo ""
echo "================================"
echo "Starting API servers..."
echo "================================"
echo ""

# Start LLM API in background
echo "Starting LLM API on http://localhost:5055"
python backend/llm_reasons.py &
PID1=$!

# Wait a bit
sleep 2

# Start ML API in background
echo "🤖 Starting ML API on http://localhost:8000"
python backend/app.py &
PID2=$!

echo ""
echo "================================"
echo "Both servers are running!"
echo ""
echo "ML API:  http://localhost:8000/docs"
echo "LLM API: http://localhost:5055/docs"
echo ""
echo "Press Ctrl+C to stop"
echo "================================"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $PID1 $PID2 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes
wait $PID1 $PID2