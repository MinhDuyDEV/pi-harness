import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DATA_FILE = join(process.cwd(), '.todos.json');

let todos = null;

function load() {
  if (todos !== null) return;
  if (existsSync(DATA_FILE)) {
    try {
      todos = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    } catch {
      todos = [];
    }
  } else {
    todos = [];
  }
}

function save() {
  writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2) + '\n');
}

function findByPrefix(id) {
  const lower = id.toLowerCase();
  return todos.find(t => t.id.toLowerCase().startsWith(lower));
}

export function add(text) {
  load();
  if (!text || !text.trim()) {
    throw new Error('Todo text cannot be empty');
  }
  const todo = {
    id: randomUUID(),
    text: text.trim(),
    completed: false,
    createdAt: new Date().toISOString(),
  };
  todos.push(todo);
  save();
  return todo;
}

export function list() {
  load();
  return [...todos].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export function complete(id) {
  load();
  const todo = findByPrefix(id);
  if (!todo) {
    throw new Error(`No todo found matching "${id}"`);
  }
  todo.completed = true;
  save();
  return todo;
}

export function remove(id) {
  load();
  const idx = todos.findIndex(t => t.id.toLowerCase().startsWith(id.toLowerCase()));
  if (idx === -1) {
    throw new Error(`No todo found matching "${id}"`);
  }
  const [removed] = todos.splice(idx, 1);
  save();
  return removed;
}

export function reset() {
  load();
  const count = todos.length;
  todos = [];
  save();
  return count;
}
