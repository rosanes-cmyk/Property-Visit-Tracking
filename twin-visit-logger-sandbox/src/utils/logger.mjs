const levels = { debug: 10, info: 20, warn: 30, error: 40 };

function serialize(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(level = 'info') {
  const threshold = levels[level] ?? levels.info;
  const write = (name, message, details = undefined) => {
    if ((levels[name] ?? 999) < threshold) return;
    const record = {
      time: new Date().toISOString(),
      level: name,
      message,
      ...(details === undefined ? {} : { details: serialize(details) })
    };
    const output = JSON.stringify(record);
    if (name === 'error') console.error(output);
    else if (name === 'warn') console.warn(output);
    else console.log(output);
  };

  return {
    debug: (message, details) => write('debug', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details)
  };
}
