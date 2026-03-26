import React from 'react';

export default (
  <div className="flex flex-col h-full">
    <div className="flex-1 overflow-y-auto pb-32 space-y-4 p-4">
      {!domains.length && !prefs && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 font-medium">Examples:</p>
          <button
            onClick={() => setInput('Short tech startup, .ai or .io')}
            className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            Short tech startup, .ai or .io
          </button>
          <button
            onClick={() => setInput('Brandable productivity tool, under 7 chars')}
            className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            Brandable productivity tool, under 7 chars
          </button>
          <button
            onClick={() => setInput('Descriptive wellness brand, .co')}
            className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            Descriptive wellness brand, .co
          </button>
        </div>
      )}

      {prefs && (prefs.keywords.length > 0 || prefs.tlds.length > 0) && (
        <div className="bg-slate-800 p-3 rounded space-y-2">
          <p className="text-xs text-slate-400 font-medium">Your preferences:</p>
          <div className="flex flex-wrap gap-2">
            {prefs.keywords.map(k => (
              <span key={k} className="px-2 py-1 bg-blue-900 rounded text-xs">
                {k}
              </span>
            ))}
            {prefs.tlds.map(t => (
              <span key={t} className="px-2 py-1 bg-purple-900 rounded text-xs">
                .{t}
              </span>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {domains.map(d => (
        <div key={d} className="bg-slate-800 p-3 rounded flex justify-between items-center gap-2">
          <span className="font-mono text-sm flex-1 break-all">{d}</span>
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => copyDomain(d)}
              className="px-2 py-1 hover:bg-slate-700 rounded text-sm"
            >
              {copied === d ? '✓' : '📋'}
            </button>
            <button
              onClick={() =>
                window.open(
                  `https://namecheap.com/domains/registration/results/?domain=${d}`,
                  '_blank'
                )
              }
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium"
            >
              Check
            </button>
          </div>
        </div>
      ))}
    </div>

    <form
      onSubmit={handleSearch}
      className="sticky bottom-0 bg-slate-900/95 p-4 border-t border-slate-700 flex gap-2"
    >
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Describe your domain..."
        className="flex-1 px-3 py-2 bg-slate-800 text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        disabled={loading}
        autoFocus
      />
      <button
        type="submit"
        disabled={loading || !input.trim()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 rounded text-sm"
      >
        →
      </button>
    </form>
  </div>
);
