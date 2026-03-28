// Provide required env vars before any module imports run
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_inspector_pika'
process.env.GITHUB_TOKEN = 'test-token'
process.env.PORT = '3001'
