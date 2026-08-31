/* =========================================================================
   KGROUP — Authorization rules (replaces Supabase Row Level Security)
   -------------------------------------------------------------------------
   WHY THIS FILE EXISTS

   Supabase enforced access control in the database with RLS policies whose
   predicates called auth.uid() — a function PostgREST populates from the
   caller's JWT. Outside Supabase there is no auth.uid(), and Neon is never
   reached by an untrusted client: the browser talks to this API, and only this
   API holds DATABASE_URL. So the policies move up one layer, into the single
   trusted process, with the predicates kept identical.

   POLICY-BY-POLICY MAPPING (supabase-schema.sql -> here)

     profiles: self read       id = auth.uid()
                               -> GET  /api/profile           (reads req.user.id)
     profiles: team read       team_id = my_team_id()
                               -> teamScope() on any profile listing
     profiles: self update     id = auth.uid()
                               -> PATCH /api/profile          (writes req.user.id only)
     profiles: self insert     id = auth.uid()
                               -> only handle_new_user() inserts profiles

     teams: member read        id = my_team_id()
                               -> teamScope()
     teams: owner all          owner = auth.uid()
                               -> only handle_new_user() creates teams

     salespersons: team read   team_id = my_team_id()          -> teamScope()
     salespersons: admin ins.  team_id = my_team_id() AND my_role() = 'admin'
                                                               -> requireAdmin() + teamScope()
     salespersons: admin upd.  (same)                          -> requireAdmin() + teamScope()
     salespersons: admin del.  (same)                          -> requireAdmin() + teamScope()

     sales: team read          team_id = my_team_id()          -> teamScope()
     sales: team insert        team_id = my_team_id()          -> teamScope()
     sales: mine or admin upd. owner = auth.uid() OR my_role() = 'admin'
                                                               -> canMutateSale()
     sales: mine or admin del. (same)                          -> canMutateSale()

     challenges: team read     team_id = my_team_id()          -> teamScope()
     challenges: admin write   team_id = my_team_id() AND my_role() = 'admin'
                                                               -> requireAdmin() + teamScope()

   Every rule below is applied as a WHERE clause on the query itself, not as a
   check after fetching, so a caller can never read or write another team's row.

   RÔLES (profiles.role — un simple `text`, aucune contrainte à migrer)
     admin           accès complet : équipe, ventes, challenges, paie, clients
     salesperson     ses ventes, ses clients (ceux dont il est responsable)
     relation_client tout le portefeuille client de l'équipe + les anniversaires,
                     mais AUCUN accès à la paie ni à l'administration
   ========================================================================= */
"use strict";

/** An error carrying the HTTP status the API should answer with. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * The caller's team id — the value every "team_id = my_team_id()" predicate
 * compared against. Throws rather than returning null, so a query can never be
 * built with an undefined scope (which would silently match nothing, or worse,
 * everything if a WHERE clause were dropped).
 */
function teamScope(req) {
  const teamId = req.profile && req.profile.team_id;
  if (!teamId) {
    throw new HttpError(
      403,
      "Your account is not linked to a team yet. Ask an administrator for a new invite link."
    );
  }
  return teamId;
}

/** The caller's role, defaulting exactly as KGAuth.role() did in the browser. */
function roleOf(req) {
  return (req.profile && req.profile.role) || "admin";
}

function isAdmin(req) {
  return roleOf(req) === "admin";
}

/**
 * Qui voit TOUT le portefeuille client de l'equipe.
 * Un commercial ne voit que les clients dont il est responsable ; un
 * administrateur et un charge de relation client voient l'ensemble.
 */
function canSeeAllClients(req) {
  const role = roleOf(req);
  return role === "admin" || role === "relation_client";
}

/**
 * Qui consulte la remuneration de TOUTE l'equipe.
 * Deliberement plus restrictif que canSeeAllClients : la paie est une donnee
 * administrative, un charge de relation client n'a pas a y acceder.
 */
function canSeeAllPayroll(req) {
  return isAdmin(req);
}

/** Les roles qu'un administrateur peut attribuer a un membre de son equipe. */
const ASSIGNABLE_ROLES = ["salesperson", "relation_client"];

/** Mirrors `my_role() = 'admin'` in the write policies. */
function requireAdmin(req) {
  if (!isAdmin(req)) {
    throw new HttpError(403, "Only administrators can perform this action.");
  }
}

/**
 * Mirrors `sales: mine or admin update/delete`
 *   using (owner = auth.uid() or my_role() = 'admin')
 * Team scope is applied separately, matching the original policy pair.
 */
function canMutateSale(req, saleRow) {
  return isAdmin(req) || (saleRow && saleRow.owner === req.user.id);
}

module.exports = {
  HttpError, teamScope, roleOf, isAdmin, requireAdmin, canMutateSale,
  canSeeAllClients, canSeeAllPayroll, ASSIGNABLE_ROLES,
};
