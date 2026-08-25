# Unrecovered production migration

Production records this migration with SHA-256:

`84b4a15f04a3cccfc556d4963a88850b71a78d13b898f2628fd3778226e126c2`

A file with the same migration name is reachable from historical commit
`1a3b7bba8413d5348b27fafcb6ff048eddb5cb6d`, but its raw SHA-256 is:

`4ef9c3111a4e3defd2083c76f5a186d95f97d47cf461cc5bf48dd0bebe2ae102`

Because the checksums differ, that historical file is only a lead and is not
archived as recovered SQL. The physical effects were audited separately against
the production schema.
