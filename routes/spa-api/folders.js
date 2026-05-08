const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/folders', (_req, res) => {
  res.json(db.prepare('SELECT * FROM folders ORDER BY parent_id, name').all());
});

module.exports = router;
