export const SUPABASE_URL = "https://jzoosgflgezrhhphcqml.supabase.co";
export const SUPABASE_KEY = "sb_publishable_RzqmU62ZqTbjc5LFFvs13A_T-3uQUiH";

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Alias para mantener la coherencia en tus archivos JS
export const supabasePublic = supabaseClient;
export const supabaseAdmin = supabaseClient;