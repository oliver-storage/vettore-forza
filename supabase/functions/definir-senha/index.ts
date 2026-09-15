// =============================================================
// Vettore — Edge Function "definir-senha"
// Troca a senha de outro usuário. Só quem tem a permissão
// 'config.usuarios.editar' consegue — a checagem usa a mesma
// função tem_permissao() do banco, com o JWT de quem chamou.
// A troca em si usa a chave de serviço (SUPABASE_SERVICE_ROLE_KEY,
// que todo projeto Supabase já expõe pras Edge Functions sozinho —
// não precisa cadastrar como secret).
//
// Uso: POST /functions/v1/definir-senha  (JSON)
//   { "perfil_id": "<uuid do perfil>", "nova_senha": "..." }
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ erro: "Use POST." }, 405);

    try {
      const { perfil_id, nova_senha } = await req.json();
      if (!perfil_id || !nova_senha) return json({ erro: "Faltam campos: perfil_id, nova_senha." }, 400);
      if (String(nova_senha).length < 6) return json({ erro: "A senha precisa ter pelo menos 6 caracteres." }, 400);

      // Confere quem está chamando e se tem permissão — com o JWT
      // de quem chamou, respeitando a RLS de sempre.
      const sbUsuario = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
      );
      const { data: quem } = await sbUsuario.auth.getUser();
      if (!quem?.user) return json({ erro: "Sessão inválida." }, 401);

      const { data: podeEditar, error: erroPermissao } = await sbUsuario.rpc("tem_permissao", {
        p_chave: "config.usuarios.editar",
      });
      if (erroPermissao || !podeEditar) return json({ erro: "Sem permissão para trocar senha de usuário." }, 403);

      // Só agora usa a chave de serviço, pra trocar a senha de verdade.
      const sbAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      const { error: erroAuth } = await sbAdmin.auth.admin.updateUserById(perfil_id, { password: nova_senha });
      if (erroAuth) throw erroAuth;

      return json({ ok: true });
    } catch (e) {
      console.error("[Vettore] definir-senha falhou:", e);
      return json({ erro: String((e as Error).message ?? e) }, 500);
    }
  },
};
