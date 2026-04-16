const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');
const db = require('../db');

const schema = buildSchema(`
  type Document {
    id: Int!
    original_name: String
    doc_type: String
    customer_cid: String
    customer_name: String
    doc_number: String
    expiry_date: String
    branch: String
    status: String
    version: String
    ocr_confidence: Float
    uploaded_at: String
  }
  type Workflow {
    id: Int!
    ref_code: String
    title: String
    stage: String
    priority: String
    updated_at: String
  }
  type Alert {
    id: Int!
    level: String
    title: String
    meta: String
    created_at: String
  }
  type Stats {
    total: Int
    expired: Int
    expiring: Int
    pending_workflows: Int
    by_type: [TypeCount]
  }
  type TypeCount { doc_type: String, count: Int }

  type Query {
    documents(limit: Int = 50, status: String, doc_type: String, branch: String, search: String): [Document]
    document(id: Int!): Document
    workflows: [Workflow]
    alerts(unread: Boolean): [Alert]
    stats: Stats
  }

  type Mutation {
    workflowAction(id: Int!, action: String!): Workflow
    markAlertRead(id: Int!): Alert
  }
`);

function apiAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing x-api-key' });
  const user = db.prepare('SELECT * FROM users WHERE api_key=? AND status=?').get(key, 'Active');
  if (!user) return res.status(401).json({ error: 'Invalid api key' });
  req.apiUser = user;
  next();
}

const root = {
  documents: ({ limit = 50, status, doc_type, branch, search }) => {
    let sql = 'SELECT * FROM documents WHERE 1=1';
    const p = [];
    if (status) { sql += ' AND status=?'; p.push(status); }
    if (doc_type) { sql += ' AND doc_type=?'; p.push(doc_type); }
    if (branch) { sql += ' AND branch=?'; p.push(branch); }
    if (search) {
      sql += ' AND (original_name LIKE ? OR customer_name LIKE ? OR customer_cid LIKE ?)';
      const like = `%${search}%`;
      p.push(like, like, like);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    p.push(Math.min(limit, 500));
    return db.prepare(sql).all(...p);
  },
  document: ({ id }) => db.prepare('SELECT * FROM documents WHERE id=?').get(id),
  workflows: () => db.prepare('SELECT * FROM workflows ORDER BY id DESC').all(),
  alerts: ({ unread }) => unread ? db.prepare('SELECT * FROM alerts WHERE is_read=0 ORDER BY id DESC').all() : db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 100').all(),
  stats: () => ({
    total: db.prepare('SELECT COUNT(*) c FROM documents').get().c,
    expired: db.prepare("SELECT COUNT(*) c FROM documents WHERE status='Expired'").get().c,
    expiring: db.prepare("SELECT COUNT(*) c FROM documents WHERE status='Expiring'").get().c,
    pending_workflows: db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage NOT IN ('Approved')").get().c,
    by_type: db.prepare("SELECT COALESCE(doc_type,'Unclassified') doc_type, COUNT(*) count FROM documents GROUP BY doc_type").all()
  }),
  workflowAction: ({ id, action }) => {
    const stageMap = { approve: 'Approved', reject: 'Rejected - Rework', escalate: 'Manager Sign-off' };
    if (!stageMap[action]) throw new Error('Invalid action');
    db.prepare("UPDATE workflows SET stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(stageMap[action], id);
    return db.prepare('SELECT * FROM workflows WHERE id=?').get(id);
  },
  markAlertRead: ({ id }) => {
    db.prepare('UPDATE alerts SET is_read=1 WHERE id=?').run(id);
    return db.prepare('SELECT * FROM alerts WHERE id=?').get(id);
  }
};

module.exports = [apiAuth, graphqlHTTP({ schema, rootValue: root, graphiql: true })];
