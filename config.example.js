// ============================================
// Configuration
// ============================================
// Copy this file to config.js and fill in your values

const CONFIG = {
    // Supabase configuration (optional - for caching move explanations)
    // Get these from your Supabase project: Settings > API
    supabase: {
        url: '',      // e.g., 'https://your-project.supabase.co'
        anonKey: ''   // e.g., 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    },

    // Anthropic API key (optional - can also be set via the UI modal)
    // Get from: https://console.anthropic.com/
    anthropicApiKey: '',

    // Engine settings
    engine: {
        depth: 18,        // Analysis depth (higher = slower but more accurate)
        multiPV: 4        // Number of candidate moves to show
    },

    // Claude model for explanations
    claudeModel: 'claude-sonnet-4-5-20250929'
};
