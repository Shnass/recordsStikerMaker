import app from './app.js';

const PORT = 3832;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});