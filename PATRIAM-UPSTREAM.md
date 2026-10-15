# Patriam upstream integration

Master includes official BlueMap upstream/master through a61e143f (October 14, 2026),
including v5.29 and transactional storage, file-stream, tile caching and watcher repairs.
Patriam cursor zoom, popup layout, frontend regression gate and Paper 26.3 packaging remain.
The new upstream periodic fingerprint scanner is disabled in this release and its new
region-file-check-interval operator key is withheld: existing HOCON configuration has no
versioned migration contract. Filesystem-event watching and existing full-update interval remain.
No operator configuration is changed and no new metrics authority is introduced.
Help uses eight entries, actual command permissions, ordinary/staff sections and console
readability. The old no-argument status is available explicitly as /bluemap status.
