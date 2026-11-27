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
import 'package:ganaderov/features/livestock/domain/event_draft.dart';
import 'package:ganaderov/features/settings/domain/animal_configuration.dart';
import 'package:uuid/uuid.dart';
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
      'universal_drafts',
      'entity_revisions',
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

  Future<Map<String, dynamic>> remoteEntity(String kind, String id) async =>
      object(
        await client.rpc(
          'sync_read_entity',
          params: {'p_owner': ownerId, 'p_kind': kind, 'p_id': id},
        ),
        'Remote $kind',
      );

  Future<void> reopenCompletionStore() async {
    await store!.close();
    store = null;
    repository = null;
    openStore('completion');
    current = await repository!.load();
  }

  Future<void> runCompletionSteps() async {
    const uuid = Uuid();
    final firstId = uuid.v4(),
        secondId = uuid.v4(),
        eventId = uuid.v4(),
        journeyId = uuid.v4();
    final today = DateTime.now().toUtc().toIso8601String().substring(0, 10);
    final yesterday = DateTime.now()
        .toUtc()
        .subtract(const Duration(days: 1))
        .toIso8601String()
        .substring(0, 10);
    final tag = 'mobile-${fixture['runId']}';
    final ids = <String>{};
    String? correctionId, deletionId;

    await step('Universal offline CRUD, new-entity dependencies, configuration and real SQLite restart', () async {
      await store!.close();
      store = null;
      repository = null;
      openStore('completion');
      current = await repository!.load();
      await repository!.prepareOfflineInventory(current!);
      await repository!.journeys(current!);
      transport.offline = true;
      current = await repository!.load();
      require(current!.offline, 'Expected a verified offline inventory');
      final before = network.length, blocked = transport.blockedOffline;
      await repository!.saveAnimal(
        current!,
        null,
        {
          'tag': '$tag-a',
          'name': 'Mobile nueva',
          'sex': 'Hembra',
          'status': 'Activo',
        },
        createId: firstId,
        operationId: uuid.v4(),
      );
      current = await repository!.refreshLocalInventory(current!);
      await repository!.saveAnimal(
        current!,
        null,
        {
          'tag': '$tag-b',
          'name': 'Mobile segunda',
          'sex': 'Macho',
          'status': 'Activo',
        },
        createId: secondId,
        operationId: uuid.v4(),
      );
      current = await repository!.refreshLocalInventory(current!);
      require(
        current!.animals
                .singleWhere((a) => a.id == firstId)
                .value('internalId') ==
            'Por asignar',
        'The client invented an internal ID',
      );
      await repository!.saveAnimal(current!, firstId, {
        'name': 'Mobile editada',
      }, operationId: uuid.v4());
      current = await repository!.refreshLocalInventory(current!);
      await repository!.setAnimalStatus(current!, firstId, 'Vendido');
      current = await repository!.refreshLocalInventory(current!);
      require(
        !current!.animals.singleWhere((a) => a.id == firstId).active,
        'Archive preview was lost',
      );
      await repository!.setAnimalStatus(current!, firstId, 'Activo');
      current = await repository!.refreshLocalInventory(current!);
      await repository!.addEvent(
        current!,
        firstId,
        EventDraft(id: eventId, type: 'weight', date: today, weight: 320),
      );
      current = await repository!.refreshLocalInventory(current!);
      await repository!.createJourney(
        current!,
        journeyId,
        'weight',
        today,
        '',
        '',
        'Mobile dependency chain',
        {firstId, secondId},
      );
      var journey = (await repository!.refreshLocalJourneys(current!))
          .singleWhere((j) => j.id == journeyId);
      await repository!.attendJourney(current!, journey, firstId, 321);
      journey = (await repository!.refreshLocalJourneys(current!))
          .singleWhere((j) => j.id == journeyId);
      await repository!.finishJourney(current!, journey);
      journey = (await repository!.refreshLocalJourneys(current!))
          .singleWhere((j) => j.id == journeyId);
      require(
        journey.status == 'incomplete',
        'Incomplete finish preview is wrong',
      );
      await repository!.resumeJourney(current!, journey);
      journey = (await repository!.refreshLocalJourneys(current!))
          .singleWhere((j) => j.id == journeyId);
      await repository!.attendJourney(current!, journey, secondId, 333);
      journey = (await repository!.refreshLocalJourneys(current!))
          .singleWhere((j) => j.id == journeyId);
      await repository!.finishJourney(current!, journey);
      final configuration = editableAnimalConfiguration(current!.config);
      (configuration['fields'] as Map)['name']['label'] = 'Nombre desde Mobile';
      await repository!.saveConfiguration(
        current!,
        configuration,
        operationId: uuid.v4(),
      );
      current = await repository!.refreshLocalInventory(current!);
      require(
        network.length == before && transport.blockedOffline == blocked,
        'Offline universal capture attempted HTTP',
      );
      final captured = await store!.localUniversalChanges(
        userId,
        ownerId,
        origin.origin,
      );
      require(
        captured.length == 13,
        'An intended capture was lost or duplicated',
      );
      ids.addAll(captured.map((entry) => entry['id'] as String));
      require(
        ids.length == 13 &&
            captured.where((entry) => entry['state'] == 'waiting').length == 10,
        'Dependent intents became sendable before their real receipts',
      );
      final canonical = await store!.read(userId, project: origin.origin);
      require(
        !canonical!.animals.any((a) => [firstId, secondId].contains(a.id)),
        'Pending creates changed the confirmed cache',
      );
      require(
        (canonical.config['fields'] as Map?)?['name']?['label'] !=
            'Nombre desde Mobile',
        'Pending configuration changed confirmed cache',
      );
      await reopenCompletionStore();
      final reopened = await store!.localUniversalChanges(
        userId,
        ownerId,
        origin.origin,
      );
      require(
        reopened.map((entry) => entry['id']).toSet().containsAll(ids),
        'Restart changed a captured UUID',
      );
      require(
        current!.offline &&
            current!.animals
                    .singleWhere((a) => a.id == firstId)
                    .value('name') ==
                'Mobile editada',
        'Restart lost the offline animal projection',
      );
      final restored = (await repository!.refreshLocalJourneys(current!))
          .singleWhere((j) => j.id == journeyId);
      require(
        restored.status == 'completed' && restored.attended == 2,
        'Restart lost the complete journey projection',
      );
      require(
        (current!.config['fields'] as Map)['name']['label'] ==
            'Nombre desde Mobile',
        'Restart lost pending configuration',
      );
      return {
        'captures': ids.length,
        'waitingForReceipts': 10,
        'captureHTTPRequests': 0,
        'firstAnimalId': firstId,
        'secondAnimalId': secondId,
        'journeyId': journeyId,
        ...await encryptedRows(),
      };
    });

    await step('Real universal delivery seals exact receipt revisions and commits offline CRUD and journey chain', () async {
      transport.offline = false;
      await repository!.syncEvents(manual: true);
      final confirmed = await store!.localUniversalChanges(
        userId,
        ownerId,
        origin.origin,
        includeArchived: true,
      );
      require(
        confirmed.length == ids.length &&
            confirmed.every((entry) => entry['state'] == 'confirmed'),
        'Real delivery did not confirm every captured intention: ${confirmed.map((entry) => '${(entry['operation'] as Map)['action']}:${entry['state']}:${entry['receipt']}').join(', ')}',
      );
      final byId = {for (final entry in confirmed) entry['id']: entry};
      var revisionsChecked = 0;
      for (final entry in confirmed) {
        final from = entry['revisionFrom'];
        if (from != null) {
          final predecessor = byId[from]!;
          require(
            (entry['operation'] as Map)['baseRevision'] ==
                (predecessor['receipt'] as Map)['revision'],
            'A dependent body did not use the exact confirmed predecessor revision',
          );
          revisionsChecked++;
        }
      }
      require(
        revisionsChecked == 8,
        'Not every same-entity dependency was exercised',
      );
      require(
        (await store!.universalPending(userId, ownerId)).isEmpty,
        'A delivered operation remains pending',
      );
      final animal = object(
        (await remoteEntity('animal', firstId))['data'],
        'Created animal',
      );
      final secondAnimal = object(
        (await remoteEntity('animal', secondId))['data'],
        'Second animal',
      );
      require(
        animal['name'] == 'Mobile editada' && animal['status'] == 'Activo',
        'Remote animal CRUD differs from intent',
      );
      require(
        RegExp(r'^ANM-\d{5,}$').hasMatch(animal['internalId'] as String) &&
            animal['internalId'] != secondAnimal['internalId'],
        'Server internal IDs are missing or collide',
      );
      final remoteJourney = object(
        (await remoteEntity('journey', journeyId))['data'],
        'Journey',
      );
      require(
        remoteJourney['status'] == 'completed' &&
            (remoteJourney['roster'] as List).every(
              (row) => (row as Map)['attended'] == true,
            ),
        'Remote finish/resume chain did not complete',
      );
      final independent = object(
        (await remoteEntity('event', eventId))['data'],
        'Independent event',
      );
      require(
        independent['weight'] == 320 && independent['animalId'] == firstId,
        'Event on the offline-created animal is missing',
      );
      for (final id in [firstId, secondId]) {
        final generated = object(
          (await remoteEntity('event', 'journey:$journeyId:$id'))['data'],
          'Journey event',
        );
        require(
          generated['journeyId'] == journeyId && generated['animalId'] == id,
          'Journey event escaped its parent',
        );
      }
      final config = object(
        (await remoteEntity('config', ownerId))['data'],
        'Configuration',
      );
      require(
        (config['fields'] as Map)['name']['label'] == 'Nombre desde Mobile',
        'Remote configuration differs from saved intent',
      );
      current = await repository!.load();
      await repository!.journeys(current!);
      require(
        (await store!.localUniversalChanges(
          userId,
          ownerId,
          origin.origin,
        )).isEmpty,
        'Causally fresh snapshots did not retire confirmed previews',
      );
      return {
        'confirmed': confirmed.length,
        'receiptRevisionsChecked': revisionsChecked,
        'internalId': animal['internalId'],
        'journeyStatus': remoteJourney['status'],
        ...await encryptedRows(),
      };
    });

    await step('Historical correction is captured offline, survives restart and preserves real event provenance', () async {
      transport.offline = true;
      current = await repository!.load();
      final event = current!.animals
          .singleWhere((a) => a.id == firstId)
          .events
          .singleWhere((e) => e.id == eventId);
      final before = network.length, blocked = transport.blockedOffline;
      await repository!.updateHistoricalEvent(
        current!,
        firstId,
        event,
        {
          'date': yesterday,
          'weight': 325,
          'product': 'Báscula ajustada',
          'notes': 'Observación corregida desde Mobile',
        },
        'Corrección documentada de la lectura',
        operationId: uuid.v4(),
      );
      final entry = (await store!.localUniversalChanges(
        userId,
        ownerId,
        origin.origin,
      )).single;
      correctionId = entry['id'] as String;
      require(
        (entry['operation'] as Map)['baseRevision'] is int &&
            (entry['operation'] as Map)['changes']['reason'] ==
                'Corrección documentada de la lectura',
        'Historical correction omitted its real revision or reason',
      );
      require(
        network.length == before && transport.blockedOffline == blocked,
        'Historical offline edit attempted HTTP',
      );
      await reopenCompletionStore();
      require(
        current!.animals
                .singleWhere((a) => a.id == firstId)
                .events
                .singleWhere((e) => e.id == eventId)
                .weight ==
            325,
        'Restart lost corrected event preview',
      );
      transport.offline = false;
      await repository!.syncEvents(manual: true);
      final remote = object(
        (await remoteEntity('event', eventId))['data'],
        'Corrected event',
      );
      require(
        remote['type'] == 'weight' &&
            remote['date'] == yesterday &&
            remote['weight'] == 325 &&
            remote['label'] == 'Báscula ajustada' &&
            remote['notes'] == 'Observación corregida desde Mobile',
        'Real historical correction changed the wrong fields',
      );
      require(
        (remote['performedBy'] as Map)['authUserId'] == userId &&
            (remote['updatedBy'] as Map)['authUserId'] == userId,
        'Real historical correction lost authenticated provenance',
      );
      current = await repository!.load();
      return {
        'operationId': correctionId,
        'eventId': eventId,
        'captureHTTPRequests': 0,
        'typePreserved': true,
      };
    });

    await step('Historical deletion with reason remains a separate offline preview until real acknowledgement', () async {
      transport.offline = true;
      current = await repository!.load();
      final event = current!.animals
          .singleWhere((a) => a.id == firstId)
          .events
          .singleWhere((e) => e.id == eventId);
      final before = network.length, blocked = transport.blockedOffline;
      await repository!.deleteHistoricalEvent(
        current!,
        firstId,
        event,
        'Registro duplicado revisado',
        operationId: uuid.v4(),
      );
      final entry = (await store!.localUniversalChanges(
        userId,
        ownerId,
        origin.origin,
      )).single;
      deletionId = entry['id'] as String;
      current = await repository!.refreshLocalInventory(current!);
      require(
        !current!.animals
            .singleWhere((a) => a.id == firstId)
            .events
            .any((e) => e.id == eventId),
        'Delete preview remained visible as an event',
      );
      final canonical = await store!.read(userId, project: origin.origin);
      require(
        canonical!.animals
            .singleWhere((a) => a.id == firstId)
            .events
            .any((e) => e.id == eventId),
        'Delete preview mutated canonical event history',
      );
      require(
        network.length == before && transport.blockedOffline == blocked,
        'Historical offline delete attempted HTTP',
      );
      await reopenCompletionStore();
      transport.offline = false;
      await repository!.syncEvents(manual: true);
      require(
        (await remoteEntity('event', eventId))['data'] == null,
        'Real deletion did not tombstone the event',
      );
      current = await repository!.load();
      require(
        !current!.animals
            .singleWhere((a) => a.id == firstId)
            .events
            .any((e) => e.id == eventId),
        'Deleted event returned after fresh pull',
      );
      return {
        'operationId': deletionId,
        'eventId': eventId,
        'captureHTTPRequests': 0,
      };
    });

    await step('A real remote conflict preserves the immutable parent and its visible blocked dependent after restart', () async {
      final baseline = await remoteEntity('animal', secondId);
      transport.offline = true;
      current = await repository!.load();
      final before = network.length, blocked = transport.blockedOffline;
      await repository!.saveAnimal(current!, secondId, {
        'name': 'Edición local en conflicto',
      }, operationId: uuid.v4());
      current = await repository!.refreshLocalInventory(current!);
      await repository!.saveAnimal(current!, secondId, {
        'name': 'Hija local que espera',
      }, operationId: uuid.v4());
      final drafts = await store!.localUniversalChanges(
        userId,
        ownerId,
        origin.origin,
      );
      require(
        drafts.length == 2 && drafts.last['state'] == 'waiting',
        'The dependent edit was not durable and waiting',
      );
      final parentBody = jsonEncode(drafts.first['operation']);
      require(
        network.length == before && transport.blockedOffline == blocked,
        'Conflict setup attempted offline HTTP',
      );
      transport.offline = false;
      final competing = object(
        await client.rpc(
          'sync_apply_operation',
          params: {
            'p_operation': {
              'protocolVersion': 1,
              'operationId': uuid.v4(),
              'action': 'animal.update',
              'entityId': secondId,
              'ownerId': ownerId,
              'deviceId': uuid.v4(),
              'baseRevision': baseline['revision'],
              'capturedAt': DateTime.now().toUtc().toIso8601String(),
              'changes': {
                'fields': {'name': 'Cambio remoto confirmado'},
              },
            },
          },
        ),
        'Competing receipt',
      );
      require(
        competing['status'] == 'applied',
        'The competing real mutation failed',
      );
      await repository!.syncEvents(manual: true);
      final terminal = await store!.localUniversalChanges(
        userId,
        ownerId,
        origin.origin,
      );
      require(
        terminal.length == 2 &&
            terminal.first['state'] == 'conflict' &&
            terminal.last['state'] == 'blocked',
        'Real conflict was hidden, discarded, rebased or automatically resolved',
      );
      require(
        jsonEncode(terminal.first['operation']) == parentBody,
        'Conflict handling rewrote the sealed body',
      );
      require(
        (terminal.last['operation'] as Map)['baseRevision'] == null &&
            terminal.last['draft'] == true,
        'A blocked dependent received an invented revision',
      );
      await reopenCompletionStore();
      final review = await repository!.reviewOperations();
      require(
        review
                .where(
                  (entry) =>
                      drafts.any((original) => original['id'] == entry['id']),
                )
                .length ==
            2,
        'A terminal parent or child disappeared from the review screen after restart',
      );
      require(
        current!.animals.singleWhere((a) => a.id == secondId).value('name') ==
            'Cambio remoto confirmado',
        'Conflict overlay replaced the newly confirmed remote state',
      );
      return {
        'parentId': drafts.first['id'],
        'dependentId': drafts.last['id'],
        'parentState': 'conflict',
        'dependentState': 'blocked',
        'autoRebase': false,
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
      await runCompletionSteps();
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
    'D4 and universal completion repository against real disposable Supabase',
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
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
