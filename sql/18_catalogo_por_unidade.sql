-- =============================================================
-- Vettore — Prestação de Contas
-- 18_catalogo_por_unidade.sql
-- O catálogo de blocos/documentos deixa de ser do sistema
-- inteiro e passa a ser por unidade de saúde. unidade_saude_id
-- NULL = "modelo padrão", copiado automaticamente pra cada
-- unidade nova (e, aqui, pras unidades que já existem).
-- Versão: v0.27.0
-- =============================================================

alter table bloco_catalogo     add column if not exists unidade_saude_id uuid references unidade_saude(id) on delete cascade;
alter table documento_catalogo add column if not exists unidade_saude_id uuid references unidade_saude(id) on delete cascade;

-- chave deixa de ser único no sistema inteiro pra ser único
-- dentro de cada unidade (ou dentro do modelo padrão).
alter table bloco_catalogo     drop constraint if exists bloco_catalogo_pkey;
alter table documento_catalogo drop constraint if exists documento_catalogo_pkey;
alter table bloco_catalogo     add column if not exists id uuid primary key default gen_random_uuid();
alter table documento_catalogo add column if not exists id uuid primary key default gen_random_uuid();

create unique index if not exists idx_bloco_catalogo_unico
  on bloco_catalogo (coalesce(unidade_saude_id::text, ''), chave);
create unique index if not exists idx_documento_catalogo_unico
  on documento_catalogo (coalesce(unidade_saude_id::text, ''), chave);

-- prestacao_documento.chave e prestacao_documento_capa.chave apontavam
-- pra documento_catalogo(chave), que não existe mais como chave única
-- sozinha — remove essas travas (o vínculo continua funcionando na
-- prática, só não é mais garantido pelo banco).
alter table prestacao_documento       drop constraint if exists prestacao_documento_chave_fkey;
alter table prestacao_documento_capa  drop constraint if exists prestacao_documento_capa_chave_fkey;

-- Fornecedores entra na mesma lista ordenável dos outros blocos —
-- é só um marcador (a tela trata esse "bloco" de um jeito especial,
-- mostrando os cartões de empresa em vez de uma lista de documento).
insert into bloco_catalogo (chave, rotulo, ordem, unidade_saude_id)
values ('fornecedores', 'Fornecedores', 30, null)
on conflict (coalesce(unidade_saude_id::text, ''), chave) do nothing;

-- Copia o modelo padrão (unidade_saude_id nulo) pra cada unidade
-- que já existe hoje, senão elas ficam sem catálogo nenhum.
insert into bloco_catalogo (chave, rotulo, ordem, unidade_saude_id)
select bc.chave, bc.rotulo, bc.ordem, us.id
from bloco_catalogo bc
cross join unidade_saude us
where bc.unidade_saude_id is null
on conflict (coalesce(unidade_saude_id::text, ''), chave) do nothing;

insert into documento_catalogo (chave, bloco, rotulo, multiplo, ordem, tem_subcapa, unidade_saude_id)
select dc.chave, dc.bloco, dc.rotulo, dc.multiplo, dc.ordem, dc.tem_subcapa, us.id
from documento_catalogo dc
cross join unidade_saude us
where dc.unidade_saude_id is null
on conflict (coalesce(unidade_saude_id::text, ''), chave) do nothing;

-- Dali pra frente, toda unidade nova recebe o modelo padrão sozinha.
create or replace function copiar_catalogo_padrao_para_unidade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into bloco_catalogo (chave, rotulo, ordem, unidade_saude_id)
  select chave, rotulo, ordem, new.id from bloco_catalogo where unidade_saude_id is null
  on conflict (coalesce(unidade_saude_id::text, ''), chave) do nothing;

  insert into documento_catalogo (chave, bloco, rotulo, multiplo, ordem, tem_subcapa, unidade_saude_id)
  select chave, bloco, rotulo, multiplo, ordem, tem_subcapa, new.id from documento_catalogo where unidade_saude_id is null
  on conflict (coalesce(unidade_saude_id::text, ''), chave) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_copiar_catalogo_unidade on unidade_saude;
create trigger trg_copiar_catalogo_unidade
  after insert on unidade_saude
  for each row execute function copiar_catalogo_padrao_para_unidade();

-- registrar_bloco/registrar_documento ganham o parâmetro da unidade
-- (nulo = modelo padrão) e a permissão certa pra cada caso.
create or replace function registrar_bloco(
  p_chave text, p_rotulo text, p_ordem integer, p_unidade_saude_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_unidade_saude_id is null then
    if not tem_permissao('config.organizacao.editar') then
      raise exception 'Sem permissão para editar o modelo padrão.';
    end if;
  else
    if not (tem_permissao('config.unidades.editar') and alcanca_unidade(p_unidade_saude_id)) then
      raise exception 'Sem permissão para editar esta unidade.';
    end if;
  end if;

  insert into bloco_catalogo (chave, rotulo, ordem, unidade_saude_id)
  values (p_chave, p_rotulo, coalesce(p_ordem, 100), p_unidade_saude_id)
  on conflict (coalesce(unidade_saude_id::text, ''), chave) do update
    set rotulo = excluded.rotulo,
        ordem  = excluded.ordem;
end;
$$;

create or replace function registrar_documento(
  p_chave text, p_bloco text, p_rotulo text, p_multiplo boolean, p_ordem integer,
  p_tem_subcapa boolean default false, p_unidade_saude_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_unidade_saude_id is null then
    if not tem_permissao('config.organizacao.editar') then
      raise exception 'Sem permissão para editar o modelo padrão.';
    end if;
  else
    if not (tem_permissao('config.unidades.editar') and alcanca_unidade(p_unidade_saude_id)) then
      raise exception 'Sem permissão para editar esta unidade.';
    end if;
  end if;

  insert into documento_catalogo (chave, bloco, rotulo, multiplo, ordem, tem_subcapa, unidade_saude_id)
  values (p_chave, p_bloco, p_rotulo, p_multiplo, coalesce(p_ordem, 100), coalesce(p_tem_subcapa, false), p_unidade_saude_id)
  on conflict (coalesce(unidade_saude_id::text, ''), chave) do update
    set bloco       = excluded.bloco,
        rotulo      = excluded.rotulo,
        multiplo    = excluded.multiplo,
        ordem       = excluded.ordem,
        tem_subcapa = excluded.tem_subcapa;
end;
$$;

-- Leitura: modelo padrão (todo mundo vê) ou só quem alcança a unidade.
drop policy if exists bloco_catalogo_ler on bloco_catalogo;
create policy bloco_catalogo_ler on bloco_catalogo
  for select to authenticated
  using (unidade_saude_id is null or alcanca_unidade(unidade_saude_id));

drop policy if exists doc_catalogo_ler on documento_catalogo;
create policy doc_catalogo_ler on documento_catalogo
  for select to authenticated
  using (unidade_saude_id is null or alcanca_unidade(unidade_saude_id));
