'use strict';

// Normalizes the adapter's native config into a flat list of button definitions.
// Falls back to translating the legacy `native.id: [{id, name}]` shape into
// single-action buttons so old configs keep working without a forced rewrite.
function normalizeButtons(native) {
    if (Array.isArray(native.buttons) && native.buttons.length) {
        return native.buttons.map((b, i) => ({
            id: b.id || `button_${i}`,
            name: b.name || `Button ${i}`,
            icon: b.icon || 'default',
            kind: b.kind === 'toggle' ? 'toggle' : 'momentary',
            invert: !!b.invert,
            confirm: !!b.confirm,
            conditions: b.conditions || null,
            actions: Array.isArray(b.actions) ? b.actions : [],
        }));
    }

    return (native.id || []).map((entry, i) => ({
        id: entry.id.replace(/[.\-]/g, '_'),
        name: entry.name || `Button ${i}`,
        icon: 'default',
        kind: 'momentary',
        confirm: false,
        conditions: null,
        actions: [{ type: 'state', stateId: entry.id, value: true, delay: 0 }],
    }));
}

const OPERATORS = {
    '==': (a, b) => a == b, // eslint-disable-line eqeqeq
    '!=': (a, b) => a != b, // eslint-disable-line eqeqeq
    '>': (a, b) => Number(a) > Number(b),
    '<': (a, b) => Number(a) < Number(b),
    '>=': (a, b) => Number(a) >= Number(b),
    '<=': (a, b) => Number(a) <= Number(b),
};

// getStateValue(id) => current value (sync lookup against adapter's cache)
async function evaluateConditions(conditions, getStateValue) {
    if (!conditions || !Array.isArray(conditions.items) || !conditions.items.length) {
        return true;
    }
    const results = await Promise.all(
        conditions.items.map(async (item) => {
            const cmp = OPERATORS[item.op] || OPERATORS['=='];
            const current = await getStateValue(item.stateId);
            return cmp(current, item.value);
        })
    );
    return conditions.mode === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ctx: { getState, setState, log }
async function runScriptAction(code, ctx) {
    // Trusted, admin-authored config only (same trust model as the ioBroker
    // `javascript` adapter's own scripts) - no vm sandboxing.
    const fn = new Function('getState', 'setState', 'wait', 'log', `return (async () => { ${code} })()`);
    return fn(ctx.getState, ctx.setState, wait, ctx.log);
}

// ctx: { getState, setState, log }
async function runActions(actions, ctx) {
    for (const action of actions) {
        if (action.delay) {
            await wait(action.delay);
        }
        if (action.type === 'script') {
            try {
                await runScriptAction(action.code, ctx);
            } catch (e) {
                ctx.log.error(`button script action failed: ${e.message}`);
            }
            continue;
        }
        // type === 'state' (default)
        let value = action.value;
        if (value === 'toggle') {
            const current = await ctx.getState(action.stateId);
            // preserve the state's own type - flipping a number (e.g. a 0/1
            // relay state) as a boolean would write true/false into it instead
            value = typeof current === 'number' ? (current ? 0 : 1) : !current;
        }
        try {
            await ctx.setState(action.stateId, value);
        } catch (e) {
            ctx.log.error(`button state action failed for ${action.stateId}: ${e.message}`);
        }
    }
}

module.exports = { normalizeButtons, evaluateConditions, runActions, OPERATORS };
