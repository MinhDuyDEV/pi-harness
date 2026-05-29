#!/usr/bin/env node

import { add, list, complete, remove, reset } from '../lib/todo.js';

const [,, command, ...args] = process.argv;

function printUsage() {
  console.log(`
Usage: todo <command> [args]

Commands:
  add <text>       Add a new todo
  list             List all todos
  complete <id>    Mark a todo as complete
  delete <id>      Delete a todo
  reset            Delete all todos
`);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

try {
  switch (command) {
    case 'add': {
      const text = args.join(' ');
      if (!text) {
        console.error('Error: Please provide todo text');
        process.exit(1);
      }
      const todo = add(text);
      console.log(`✓ Added: "${todo.text}" (id: ${todo.id.slice(0, 8)})`);
      break;
    }

    case 'list': {
      const todos = list();
      if (todos.length === 0) {
        console.log('No todos yet. Add one with: todo add <text>');
      } else {
        console.log(`\n  ${'ID'.padEnd(10)} ${'Status'.padEnd(10)} ${'Created'.padEnd(14)} Text`);
        console.log('  ' + '─'.repeat(60));
        for (const t of todos) {
          const status = t.completed ? '✓ done' : '○ todo';
          console.log(`  ${t.id.slice(0, 8).padEnd(10)} ${status.padEnd(10)} ${formatDate(t.createdAt).padEnd(14)} ${t.text}`);
        }
        console.log(`\n  ${todos.length} todo(s) total\n`);
      }
      break;
    }

    case 'complete': {
      const id = args[0];
      if (!id) {
        console.error('Error: Please provide a todo ID');
        process.exit(1);
      }
      const todo = complete(id);
      console.log(`✓ Completed: "${todo.text}" (id: ${todo.id.slice(0, 8)})`);
      break;
    }

    case 'delete': {
      const id = args[0];
      if (!id) {
        console.error('Error: Please provide a todo ID');
        process.exit(1);
      }
      const todo = remove(id);
      console.log(`✓ Deleted: "${todo.text}" (id: ${todo.id.slice(0, 8)})`);
      break;
    }

    case 'reset': {
      const count = reset();
      console.log(`✓ Cleared ${count} todo(s)`);
      break;
    }

    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
