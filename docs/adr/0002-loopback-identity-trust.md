# Loopback is a trust boundary for the owner's identity

In production the API trusts the `Tailscale-User-Login` header that Tailscale Serve adds, and listens on loopback only (`apps/api/README.md`). Any local process that can reach that port could send the header itself. This is accepted because Ember has one owner on a host the owner controls. Supporting more users first needs real accounts, account deletion, per-user data isolation and a security review; the header trust is not enough for that.
