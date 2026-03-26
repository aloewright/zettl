import('./vite.config').then(mod => {
  const exported = mod.default ?? mod;
  const config = typeof exported === 'function' 
    ? exported({ command: 'serve', mode: 'test' })
    : exported;
    
  console.log('Config:', JSON.stringify(config, null, 2));
  console.log('\nPlugins:', config.plugins);
  
  const plugins = Array.isArray(config.plugins) ? config.plugins.flat() : [config.plugins];
  console.log('\nFlattened plugins:', plugins.length);
  
  plugins.forEach((p, i) => {
    if (p && typeof p === 'object') {
      console.log(`\nPlugin ${i}:`, p.name || 'unnamed');
      console.log('Keys:', Object.keys(p));
      if (p.name === 'vite-plugin-pwa') {
        console.log('PWA Plugin found!');
        console.log('api:', p.api);
        console.log('All keys:', Object.keys(p));
      }
    }
  });
});
