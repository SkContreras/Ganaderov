// Runs with `flutter test` in a fixed Ganaderov-Mobile checkout.
// Auth, PostgREST/RPC, Storage, repository, SQLite and AES-GCM are real.
// The HTTP gate interrupts transport while offline; it never fabricates replies.
// No Android UI, physical device or platform keystore is exercised here.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ganaderov/core/database/local_cipher.dart';
import 'package:ganaderov/core/database/offline_store.dart';
import 'package:ganaderov/features/livestock/data/supabase_inventory_repository.dart';
import 'package:ganaderov/features/livestock/domain/animal_photos.dart';
import 'package:ganaderov/features/livestock/domain/inventory.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:pointycastle/digests/sha256.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

String digest(Uint8List bytes) => SHA256Digest()
    .process(bytes)
    .map((value) => value.toRadixString(16).padLeft(2, '0'))
    .join();

void require(bool condition, String message) {
  if (!condition) throw StateError(message);
}

Map<String, dynamic> object(Object? value, String label) {
  require(value is Map, '$label must be an object');
  return Map<String, dynamic>.from(value as Map);
}

Uri safeOrigin(String source) {
  final uri = Uri.tryParse(source);
  require(uri != null, 'Missing backend URL');
  require(
    !source.toLowerCase().contains('vptsuhlnhtqxadztgdxn'),
    'Production Supabase is forbidden',
  );
  require(
    ['http', 'https'].contains(uri!.scheme) &&
        ['127.0.0.1', 'localhost', '::1'].contains(uri.host) &&
        uri.hasPort &&
        uri.port >= 1024 &&
        uri.port <= 65535 &&
        uri.userInfo.isEmpty &&
        !uri.hasQuery &&
        !uri.hasFragment &&
        (uri.path.isEmpty || uri.path == '/'),
    'Only a clean explicit-port loopback backend origin is allowed',
  );
  return Uri.parse(uri.origin);
}

void clientKeyOnly(String key) {
  if (key.startsWith('sb_publishable_') && key.length > 20) return;
  Map<String, dynamic>? claims;
  try {
    final parts = key.split('.');
    if (parts.length == 3) {
      claims = object(
        jsonDecode(
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
        ),
        'Anon claims',
      );
    }
  } catch (_) {}
  require(
    claims?['role'] == 'anon',
    'Only a client publishable key or anon JWT is allowed',
  );
}

class LocalTransport extends http.BaseClient {
  LocalTransport(this.origin, this.entries)
    : delegate = IOClient(
        HttpClient()..connectionTimeout = const Duration(seconds: 5),
      );
  final Uri origin;
  final http.Client delegate;
  final List<Map<String, dynamic>> entries;
  bool offline = false;
  String phase = 'startup';
  int blockedOffline = 0;
  int blockedExternal = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.origin != origin.origin) {
      blockedExternal++;
      throw StateError('Unexpected external origin blocked');
    }
    // Never follow a redirect to an unapproved target with client credentials.
    request.followRedirects = false;
    if (offline) {
      blockedOffline++;
      throw const SocketException('Local integration transport is offline');
    }
    final entry = <String, dynamic>{
      'phase': phase,
      'method': request.method,
      'path': request.url.path,
    };
    // Auth bodies, headers, tokens, keys and query strings are never retained.
    if (request is http.Request &&
        request.url.path.endsWith('/rpc/sync_apply_operation')) {
      final payload = object(jsonDecode(request.body), 'RPC envelope');
      final op = object(payload['p_operation'], 'Operation');
      entry['operation'] = {
        'id': op['operationId'],
        'action': op['action'],
        'entityId': op['entityId'],
        'baseRevision': op['baseRevision'],
      };
    }
    entries.add(entry);
    final response = await delegate.send(request);
    entry['status'] = response.statusCode;
    return response;
  }

  @override
  void close() => delegate.close();
}

class RealPhotoSuite {
  RealPhotoSuite(this.fixture, this.out);
  final Map<String, dynamic> fixture;
  final Directory out;
  final results = <Map<String, dynamic>>[];
  final network = <Map<String, dynamic>>[];
  late final Map<String, dynamic> owner = object(
    object(fixture['accounts'], 'accounts')['ownerA'],
    'ownerA',
  );
  late final Map<String, dynamic> entities = object(
    object(fixture['entities'], 'entities')['ownerA'],
    'ownerA entities',
  );
  late final String userId = owner['id'] as String;
  late final String ownerId = entities['ownerId'] as String;
  late final String animalId =
      object(entities['animals'], 'animals')['mobile'] as String;
  late final List<Map<String, dynamic>> fixtures =
      (entities['mobilePhotos'] as List)
          .map((item) => object(item, 'mobile photo'))
          .toList();
  Uri? _origin;
  LocalTransport? _transport;
  SupabaseClient? _client;
  Uri get origin => _origin!;
  LocalTransport get transport => _transport!;
  SupabaseClient get client => _client!;
  late final Uint8List key = LocalCipher.randomBytes(32);
  Directory? temporary;
  OfflineStore? store;
  SupabaseInventoryRepository? repository;
  InventorySnapshot? current;
  String? cropOperationId, primaryOperationId;
  String? sourceCommit;
  bool executed = false;
  bool failed = false;

  String redact(Object value) {
    var text = value.toString();
    final accounts = object(fixture['accounts'], 'accounts').values;
    final secrets = [
      fixture['clientKey'],
      ...accounts.expand((account) {
        final values = object(account, 'account');
        return [values['email'], values['password']];
      }),
    ];
    for (final secret in secrets.whereType<String>()) {
      if (secret.isNotEmpty) text = text.replaceAll(secret, '[REDACTED]');
    }
    return text.replaceAll(
      RegExp(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'),
      '[JWT REDACTED]',
    );
  }

  Future<void> step(
    String name,
    Future<Map<String, dynamic>> Function() action,
  ) async {
    transport.phase = name;
    final timer = Stopwatch()..start();
    try {
      final detail = await action();
      results.add({
        'case': name,
        'status': 'passed',
        'milliseconds': timer.elapsedMilliseconds,
        'detail': detail,
      });
      // ignore: avoid_print
      print('PASS $name');
    } catch (error) {
      failed = true;
      final safe = redact(error);
      results.add({
        'case': name,
        'status': 'failed',
        'milliseconds': timer.elapsedMilliseconds,
        'error': safe,
      });
      throw TestFailure('$name: $safe');
    }
  }

  void openStore(String name) {
    store = OfflineStore(
      NativeDatabase(File('${temporary!.path}/$name.sqlite')),
      LocalCipher(key),
    );
    repository = SupabaseInventoryRepository(
      client,
      store: store,
      universalEnabled: true,
      project: origin.origin,
    );
  }

  List<AnimalPhoto> photos(InventorySnapshot snapshot) =>
      AnimalPhoto.fromSnapshot(snapshot, animalId);

  Future<List<Map<String, dynamic>>> originals(
    InventorySnapshot snapshot,
  ) async {
    final hashes = <Map<String, dynamic>>[];
    for (final fixture in fixtures) {
      final photo = photos(snapshot)
          .singleWhere((photo) => photo.id == fixture['id']);
      final bytes = await repository!.readPhoto(snapshot, animalId, photo);
      final hash = digest(bytes);
      require(
        hash == fixture['sha256'],
        'Original bytes changed or are missing',
      );
      hashes.add({'id': photo.id, 'sha256': hash, 'bytes': bytes.length});
    }
    return hashes;
  }

  Future<Map<String, dynamic>> encryptedRows() async {
    final counts = <String, int>{};
    for (final table in [
      'inventory_cache',
      'photo_metadata',
      'photo_originals',
      'universal_outbox',
    ]) {
      // The table names above are fixed test constants, not external input.
      final rows = await store!
          .customSelect('SELECT payload FROM $table')
          .get();
      require(
        rows.every(
          (row) =>
              row.read<String>('payload').startsWith(LocalCipher.accountPrefix),
        ),
        'Unencrypted data in $table',
      );
      counts[table] = rows.length;
    }
    return {'aesGcmAccountRows': counts};
  }

  Future<Map<String, dynamic>> remotePhoto(String id) async => object(
    await client.rpc(
      'sync_read_entity',
      params: {'p_owner': ownerId, 'p_kind': 'photo', 'p_id': id},
    ),
    'Remote photo',
  );

  Future<Map<String, dynamic>> pendingOperation(String action) async {
    final entries = await store!.universalPending(userId, ownerId);
    require(entries.length == 1, 'Expected one durable pending operation');
    final operation = object(entries.single['operation'], 'Pending operation');
    require(operation['action'] == action, 'Unexpected queued action');
    require(
      operation['changes'] is Map &&
          (operation['changes'] as Map)['animalId'] == animalId,
      'Operation escaped its isolated fixture',
    );
    return operation;
  }

  Future<void> assertConfirmed(String id) async {
    require(
      (await store!.confirmedPhotoOperations(
        userId,
        origin.origin,
      )).contains(id),
      'Real RPC did not durably confirm the operation',
    );
    require(
      (await store!.universalPending(userId, ownerId)).isEmpty,
      'A confirmed operation remained pending',
    );
    final raw = await store!
        .customSelect(
          "SELECT state,receipt FROM universal_outbox WHERE state='confirmed'",
        )
        .get();
    require(
      raw.isNotEmpty &&
          raw.every(
            (row) => row
                .read<String>('receipt')
                .startsWith(LocalCipher.accountPrefix),
          ),
      'Receipt is missing or not encrypted',
    );
  }

  Future<void> crossCheckWeb(InventorySnapshot snapshot) async {
    final reportPath = Platform.environment['GANADEROV_WEB_BROWSER_REPORT'];
    if (reportPath == null || reportPath.isEmpty) {
      results.add({
        'case': 'Web to Flutter metadata interoperability',
        'status': 'skipped',
        'reason': 'No browser report supplied; isolated Mobile fixture is still fully exercised.',
      });
      return;
    }
    await step('Web to Flutter metadata interoperability', () async {
      final report = object(
        jsonDecode(await File(reportPath).readAsString()),
        'Web report',
      );
      require(
        report['status'] == 'passed' && report['runId'] == fixture['runId'],
        'Expected a passing Web run for the same fixture',
      );
      require(
        object(report['target'], 'Web target')['apiOrigin'] == origin.origin,
        'Web used a different backend',
      );
      final cases = (report['tests'] as List).map(
        (entry) => object(entry, 'Web case'),
      );
      final fresh = cases.singleWhere(
        (entry) =>
            entry['name'] ==
            'Independent clean browser login sees the committed remote state',
      );
      final detail = object(fresh['detail'], 'Web committed state');
      final expectedCrop = object(detail['photoCrop'], 'Web crop');
      final calls = (report['network'] as List).map(
        (entry) => object(entry, 'Web request'),
      );
      final cropCall = calls.firstWhere(
        (entry) =>
            entry['operation'] is Map &&
            (entry['operation'] as Map)['action'] == 'photo.crop',
      );
      final cropId = (cropCall['operation'] as Map)['entityId'];
      final browserAnimal =
          object(entities['animals'], 'animals')['browser'] as String;
      final webPhotos = AnimalPhoto.fromSnapshot(snapshot, browserAnimal);
      final crop = webPhotos.singleWhere((photo) => photo.id == cropId).crop;
      require(
        crop.x == expectedCrop['x'] &&
            crop.y == expectedCrop['y'] &&
            crop.zoom == expectedCrop['zoom'],
        'Flutter did not read the crop committed by Web',
      );
      require(
        webPhotos.singleWhere((photo) => photo.primary).id ==
            detail['primaryId'],
        'Flutter did not read the primary selected by Web',
      );
      return {
        'browserAnimalId': browserAnimal,
        'photoId': cropId,
        'primaryId': detail['primaryId'],
        'crop': expectedCrop,
        'webCommit': object(report['source'], 'Web source')['commit'],
      };
    });
  }

  Future<void> run() async {
    try {
      require(
        Platform.environment['GANADEROV_DISPOSABLE_HTTP'] == 'YES',
        'Set GANADEROV_DISPOSABLE_HTTP=YES for an isolated local stack',
      );
      require(
        fixture['disposable'] == true,
        'Fixture must declare disposable:true',
      );
      _origin = safeOrigin(fixture['apiUrl'] as String);
      clientKeyOnly(fixture['clientKey'] as String);
      require(
        fixtures.length >= 2 &&
            fixtures.every((photo) => photo['animalId'] == animalId),
        'Missing isolated Mobile photo fixtures',
      );
      require(
        fixtures.every(
          (photo) =>
              RegExp(r'^[a-f0-9]{64}$').hasMatch(photo['sha256'] as String),
        ),
        'Fixture original hashes are required',
      );
      _transport = LocalTransport(origin, network);
      _client = SupabaseClient(
        origin.origin,
        fixture['clientKey'] as String,
        httpClient: transport,
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      temporary = await Directory.systemTemp.createTemp(
        'ganaderov-mobile-real-',
      );
      openStore('original');
      final commit = await Process.run('git', ['rev-parse', 'HEAD']);
      sourceCommit = commit.exitCode == 0
          ? commit.stdout.toString().trim()
          : Platform.environment['GANADEROV_MOBILE_COMMIT'];
      executed = true;

      await step(
        'Real Auth login, repository pull, Storage and encrypted SQLite cache',
        () async {
          final login = await client.auth.signInWithPassword(
            email: owner['email'] as String,
            password: owner['password'] as String,
          );
          require(
            login.user?.id == userId,
            'Auth returned the wrong fixture identity',
          );
          current = await repository!.load();
          require(
            current!.status == 'active' &&
                current!.ownerId == ownerId &&
                current!.role == 'owner' &&
                !current!.offline,
            'Repository did not load the real owner ranch',
          );
          final hashes = await originals(current!);
          for (final photo in fixtures) {
            final metadata = await store!.readPhotoMetadata(
              userId,
              ownerId,
              origin.origin,
              photo['id'] as String,
            );
            require(
              metadata?['revision'] is int,
              'Reading the actual original did not cache its real revision',
            );
          }
          return {
            'userId': userId,
            'ownerId': ownerId,
            'animalId': animalId,
            'originals': hashes,
            ...await encryptedRows(),
          };
        },
      );
      await crossCheckWeb(current!);
      final first = photos(current!).firstWhere(
        (photo) => photo.primary,
        orElse: () => photos(current!).first,
      );
      final second = photos(current!)
          .firstWhere((photo) => photo.id != first.id);
      final baseline = first.crop;
      const wanted = PhotoCrop(x: 83, y: 26, zoom: 2.4);
      int? cropBaseRevision;

      await step('Offline fallback and crop capture use real cached revision without HTTP', () async {
        transport.offline = true;
        current = await repository!.load();
        require(
          current!.offline,
          'Repository did not fall back after interrupted transport',
        );
        final forwarded = network.length, blocked = transport.blockedOffline;
        await repository!.savePhotoCrop(current!, animalId, first.id, wanted);
        final pending = await pendingOperation('photo.crop');
        cropOperationId = pending['operationId'] as String;
        cropBaseRevision = pending['baseRevision'] as int;
        require(
          network.length == forwarded && transport.blockedOffline == blocked,
          'Offline capture attempted an HTTP request',
        );
        final canonical = await store!.read(userId, project: origin.origin);
        final canonicalCrop = photos(canonical!)
            .singleWhere((photo) => photo.id == first.id)
            .crop;
        require(
          canonicalCrop.x == baseline.x &&
              canonicalCrop.y == baseline.y &&
              canonicalCrop.zoom == baseline.zoom,
          'Pending overlay changed canonical metadata',
        );
        current = await repository!.refreshPhotoChanges(current!);
        final preview = photos(current!)
            .singleWhere((photo) => photo.id == first.id)
            .crop;
        require(
          preview.x == wanted.x &&
              preview.y == wanted.y &&
              preview.zoom == wanted.zoom &&
              current!.photoSyncStates[animalId] == 'pending',
          'Pending projection is incorrect',
        );
        var blockedSecond = false;
        try {
          await repository!.primaryPhoto(current!, animalId, second.id);
        } on StateError {
          blockedSecond = true;
        }
        require(
          blockedSecond &&
              (await store!.universalPending(userId, ownerId)).length == 1,
          'A second unresolved photo operation was accepted',
        );
        return {
          'operationId': cropOperationId,
          'baseRevision': cropBaseRevision,
          'captureHTTPRequests': 0,
          'originals': await originals(current!),
          ...await encryptedRows(),
        };
      });

      await step(
        'Close and reopen the real database and repository while disconnected',
        () async {
          await store!.close();
          store = null;
          repository = null;
          openStore('original');
          current = await repository!.load();
          final pending = await pendingOperation('photo.crop');
          require(
            pending['operationId'] == cropOperationId,
            'Restart changed the durable UUID',
          );
          final restored = photos(current!)
              .singleWhere((photo) => photo.id == first.id)
              .crop;
          require(
            current!.offline &&
                restored.x == wanted.x &&
                restored.y == wanted.y &&
                restored.zoom == wanted.zoom,
            'Offline restart lost the pending projection',
          );
          return {
            'operationId': cropOperationId,
            'realFileReopened': true,
            'originals': await originals(current!),
            ...await encryptedRows(),
          };
        },
      );

      await step('Reconnection flushes real crop RPC and a new snapshot retires the overlay', () async {
        transport.offline = false;
        await repository!.syncEvents(manual: true);
        await assertConfirmed(cropOperationId!);
        final remote = await remotePhoto(first.id);
        final data = object(remote['data'], 'Remote crop');
        require(
          remote['revision'] == cropBaseRevision! + 1,
          'Crop did not advance the real entity revision once',
        );
        require(
          data['cropX'] == wanted.x &&
              data['cropY'] == wanted.y &&
              data['cropZoom'] == wanted.zoom,
          'Remote crop differs from captured intent',
        );
        current = await repository!.load();
        require(
          !current!.offline && !current!.photoSyncStates.containsKey(animalId),
          'Confirmed overlay remained after remote snapshot',
        );
        require(
          (await store!.photoChanges(userId, ownerId, origin.origin)).isEmpty,
          'Durable preview pointer was not retired',
        );
        return {
          'operationId': cropOperationId,
          'remoteRevision': remote['revision'],
          'originals': await originals(current!),
        };
      });

      await step('Primary selection queues offline then confirms with real CAS and preserved crop', () async {
        transport.offline = true;
        current = await repository!.load();
        final before = network.length, blocked = transport.blockedOffline;
        await repository!.primaryPhoto(current!, animalId, second.id);
        final pending = await pendingOperation('photo.primary');
        primaryOperationId = pending['operationId'] as String;
        require(
          network.length == before && transport.blockedOffline == blocked,
          'Offline primary selection attempted HTTP',
        );
        current = await repository!.refreshPhotoChanges(current!);
        require(
          photos(current!).singleWhere((photo) => photo.primary).id ==
              second.id,
          'Pending primary projection is incorrect',
        );
        transport.offline = false;
        await repository!.syncEvents(manual: true);
        await assertConfirmed(primaryOperationId!);
        current = await repository!.load();
        require(
          !current!.photoSyncStates.containsKey(animalId),
          'Primary preview was not retired',
        );
        require(
          photos(current!).singleWhere((photo) => photo.primary).id ==
              second.id,
          'Canonical primary is incorrect',
        );
        final remote = await remotePhoto(second.id);
        require(
          object(remote['data'], 'Remote primary')['primary'] == true,
          'Remote primary was not committed',
        );
        final crop = photos(current!)
            .singleWhere((photo) => photo.id == first.id)
            .crop;
        require(
          crop.x == wanted.x && crop.y == wanted.y && crop.zoom == wanted.zoom,
          'Choosing a primary photo lost an earlier crop',
        );
        return {
          'operationId': primaryOperationId,
          'primaryId': second.id,
          'remoteRevision': remote['revision'],
          'originals': await originals(current!),
        };
      });

      await step('A separate empty encrypted store pulls committed metadata and original bytes', () async {
        await store!.close();
        store = null;
        repository = null;
        openStore('independent');
        current = await repository!.load();
        require(
          !current!.offline &&
              (await store!.universalPending(userId, ownerId)).isEmpty,
          'Independent repository inherited a local queue',
        );
        require(
          photos(current!).singleWhere((photo) => photo.primary).id ==
              second.id,
          'Fresh pull did not see the selected primary',
        );
        final crop = photos(current!)
            .singleWhere((photo) => photo.id == first.id)
            .crop;
        require(
          crop.x == wanted.x && crop.y == wanted.y && crop.zoom == wanted.zoom,
          'Fresh pull did not see the committed crop',
        );
        return {
          'freshDatabase': true,
          'originals': await originals(current!),
          ...await encryptedRows(),
        };
      });

      await step(
        'Network evidence proves real local Auth, REST, RPC and Storage',
        () async {
          require(
            transport.blockedExternal == 0,
            'An external origin was attempted',
          );
          require(
            network.any(
              (entry) =>
                  entry['path'] == '/auth/v1/token' && entry['status'] == 200,
            ),
            'No successful real Auth login was observed',
          );
          require(
            network.any(
              (entry) =>
                  entry['path'] == '/rest/v1/animal_sync_records' &&
                  entry['status'] == 200,
            ),
            'No real inventory REST pull was observed',
          );
          require(
            network.any(
              (entry) =>
                  (entry['path'] as String).startsWith('/storage/v1/object/') &&
                  entry['status'] == 200,
            ),
            'No real Storage download was observed',
          );
          final mutations = network
              .where((entry) => entry.containsKey('operation'))
              .toList();
          require(
            mutations.length == 2 &&
                mutations.every((entry) => entry['status'] == 200),
            'Expected exactly two successful real metadata RPC requests',
          );
          require(
            mutations
                .map((entry) => (entry['operation'] as Map)['id'])
                .toSet()
                .containsAll([cropOperationId, primaryOperationId]),
            'Sent operation UUIDs differ from the durable queue',
          );
          return {
            'requests': network.length,
            'mutations': mutations,
            'offlineLoadFailures': transport.blockedOffline,
            'externalRequests': 0,
          };
        },
      );
    } catch (_) {
      failed = true;
      rethrow;
    } finally {
      await store?.close();
      await _client?.dispose();
      _transport?.close();
      if (temporary != null) await temporary!.delete(recursive: true);
      if (temporary != null) key.fillRange(0, key.length, 0);
      await out.create(recursive: true);
      final report = {
        'runId': fixture['runId'],
        'generatedAt': DateTime.now().toUtc().toIso8601String(),
        'status': failed ? 'failed' : 'passed',
        'executed': executed,
        'mobileCommit': sourceCommit,
        'target': {
          'apiOrigin': _origin?.origin,
          'disposable': fixture['disposable'],
          'productionAccess': false,
        },
        'scope': {
          'realRepository': executed,
          'realSQLite': executed,
          'realAesGcm': executed,
          'realAuth': network.any(
            (entry) =>
                entry['path'] == '/auth/v1/token' && entry['status'] == 200,
          ),
          'realPostgREST': network.any(
            (entry) =>
                (entry['path'] as String).startsWith('/rest/') &&
                entry['status'] == 200,
          ),
          'realStorage': network.any(
            (entry) =>
                (entry['path'] as String).startsWith('/storage/') &&
                entry['status'] == 200,
          ),
          'rpcMocks': false,
          'storageMocks': false,
          'authMocks': false,
          'offlineMechanism':
              'HTTP transport interruption; no synthetic responses',
          'restart': 'Repository and real SQLite connection; same test-provided random cipher key',
          'physicalAndroidDevice': false,
          'androidUI': false,
          'androidKeystore': false,
        },
        'cases': results,
        'network': network,
      };
      await File('${out.path}/report.json').writeAsString(
        redact(const JsonEncoder.withIndent('  ').convert(report)),
      );
    }
  }
}

void main() {
  final path = Platform.environment['GANADEROV_FIXTURES'];
  test('Preflight refuses production, external hosts and privileged keys without HTTP', () {
    for (final url in [
      'https://vptsuhlnhtqxadztgdxn.supabase.co',
      'https://example.org:54321',
      'http://127.0.0.1:54321/rest/v1',
    ]) {
      expect(() => safeOrigin(url), throwsStateError);
    }
    expect(
      safeOrigin('http://127.0.0.1:54321').origin,
      'http://127.0.0.1:54321',
    );
    final serviceClaims = base64Url
        .encode(utf8.encode(jsonEncode({'role': 'service_role'})))
        .replaceAll('=', '');
    expect(
      () => clientKeyOnly('fixture.$serviceClaims.signature'),
      throwsStateError,
    );
    expect(() => clientKeyOnly('sb_secret_forbidden'), throwsStateError);
  });
  test(
    'D4 repository against real disposable Supabase',
    () async {
      Map<String, dynamic> fixture;
      try {
        fixture = object(
          jsonDecode(await File(path!).readAsString()),
          'Fixtures',
        );
      } catch (_) {
        throw TestFailure(
          'Cannot read the private fixture manifest; do not print it or substitute production configuration.',
        );
      }
      final output =
          Platform.environment['GANADEROV_MOBILE_ARTIFACTS'] ??
          '${Directory.systemTemp.path}/ganaderov-mobile-real-artifacts';
      await RealPhotoSuite(fixture, Directory(output)).run();
    },
    skip: path == null || path.isEmpty
        ? 'No disposable fixture supplied; real integration was not executed.'
        : false,
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
