import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';    
import { processInventory } from './functions.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const viewsPath = path.join(__dirname, 'views');


app.set('view engine', 'pug')
app.set('views', viewsPath);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index', { title: 'My App', message: 'Hello there!', text: 'sample textik' }); 
});
app.post('/fetch', async (req, res) => {
  res.render('await', { title: 'Please wait', store: req.body.store, qty: req.body.qty });
});
app.post('/process', async (req, res) => {
  const { store, qty } = req.body;
  const cards = await processInventory(store, qty);
  console.log(`Processed ${cards.length} cards.`);
  console.log(cards);
  if(store.toLowerCase() === 'entrall'){
    res.render('results-entrall', { title: 'Results', cards });
  } else res.render('results', { title: 'Results', cards });
});

export default app;