# Datenschutzerklärung

**Fassung 2026-09-16**

Diese Erklärung beschreibt, was lockin speichert, warum, und wer es sonst noch
zu sehen bekommt. Sie ist absichtlich konkret: sie zählt auf, was tatsächlich
in der Datenbank steht, nicht was eine Fitness-App üblicherweise erhebt.

## Wer verantwortlich ist

Der Betreiber dieser App. Kontakt über die im App Store hinterlegte Adresse.

## Was gespeichert wird

**Zu deinem Konto:** Name und E-Mail-Adresse, soweit du sie bei der Anmeldung
mit Apple freigibst — Apple erlaubt dir, beides zu verbergen, und die App
funktioniert dann genauso. Dazu eine von Apple vergebene Kennung, Zeitzone,
Sprache und wann du zuletzt aktiv warst.

**Zu deinem Körper:** Größe, Geburtsjahr, Geschlecht, Zielgewicht, jede
Gewichtsmessung, Maße wie Bauchumfang, und deine Kalorien- und Proteinziele.

**Zu deinem Training:** jede Einheit mit Datum, Ort, Übungen, Gewicht,
Wiederholungen, gefühlter Anstrengung und ob Gelenke wehgetan haben. Dazu
Cardio-Einheiten und dein Trainingsprogramm.

**Zu deiner Ernährung:** jede eingetragene Mahlzeit mit geschätzten Nährwerten,
deine Lebensmittel-Bibliothek und deine Ernährungsregeln. Wenn du deinen
Kühlschrank fotografierst, wird die Liste gespeichert, die du danach
bestätigst — nicht das Foto.

**Auf dem Server wird kein Foto gespeichert.** Weder von deinem Essen, noch
von deinem Kühlschrank, noch von dir. Ein Bild geht einmal an das Sprachmodell
und ist danach weg. Was bleibt, ist die Zahl, die du bestätigt hast,
beziehungsweise der Text, den der Trainer dazu geschrieben hat.

**Fortschrittsfotos bleiben auf deinem Telefon.** Wenn du einmal in der Woche
ein Foto von dir machst, wird es im Speicherbereich der App auf deinem Gerät
abgelegt und von dort nirgendwohin übertragen — außer einmal an das
Sprachmodell, zusammen mit bis zu drei früheren Fotos, damit es den Vergleich
beschreiben kann. Gespeichert wird bei uns nur dieser Text und das Datum.
Das heißt auch: ein neues Telefon bedeutet ein leeres Album, und dein
Datenexport enthält die Texte, aber keine Bilder. Du kannst jedes Foto in der
App einzeln löschen.

**Aus Apple Health**, nur wenn du es erlaubst: Schritte, Schlaf, Ruhepuls,
Trainingseinheiten und Gewicht von einer Waage.

**Deine Unterhaltung mit dem Trainer**, vollständig, weil er sich sonst nicht
an sie erinnern könnte.

**Auswertungen nach dem Training:** die Zahlen einer Einheit und der kurze
Text, den der Trainer dazu geschrieben hat.

**Wöchentliche Foto-Auswertungen:** das Datum und der Text, den der Trainer zu
deinen Fortschrittsfotos geschrieben hat. Bewusst ohne Zahlen: aus einem Bild
lässt sich kein Körperfettanteil messen, und die App tut nicht so, als ginge
das.

**Technisch:** ein Push-Token je Gerät, und eine Zählung, wie viele Anfragen an
das Sprachmodell auf dein Konto entfallen sind.

Gesundheits- und Trainingsdaten sind besondere Kategorien personenbezogener
Daten nach Art. 9 DSGVO. Rechtsgrundlage ist deine ausdrückliche Einwilligung
nach Art. 9 Abs. 2 lit. a DSGVO, die du beim ersten Start gibst und jederzeit
zurücknehmen kannst.

## Was **nicht** passiert

Keine Werbung. Keine Analyse- oder Tracking-Dienste. Kein Verkauf und keine
Weitergabe an Dritte zu deren eigenen Zwecken. Kein Profil für Werbezwecke.

## Wer es sonst sieht

**Google (Gemini).** Damit der Trainer antworten kann, gehen deine Nachrichten
und der Zusammenhang, den er dafür braucht — deine aktuellen Zahlen samt der
Daten aus Apple Health, dein Plan, die letzten zwei Wochen — an Googles
Sprachmodell. Ebenso Fotos von Essen oder Kühlschrank, damit es sie lesen kann,
deine Fortschrittsfotos, wenn du eines machst — das aktuelle und bis zu drei
frühere —, und nach jedem Training die Zahlen dieser Einheit für die
Auswertung. Das
findet außerhalb der EU statt, auf Grundlage der EU-Standardvertragsklauseln. Ohne diese Übermittlung
gibt es keinen Trainer; alles andere in der App funktioniert auch ohne.

**Apple.** Push-Nachrichten laufen über Apples Dienst. Der Inhalt einer
Nachricht geht dabei durch Apples Infrastruktur.

**OpenFoodFacts.** Beim Scannen eines Barcodes wird die Nummer des Produkts
abgefragt. Es wird nichts über dich mitgeschickt.

**DigitalOcean.** Der Server mit der Datenbank steht in einem Rechenzentrum
von DigitalOcean in Frankfurt am Main. DigitalOcean ist ein US-Unternehmen; die
Auftragsverarbeitung stützt sich auf die EU-Standardvertragsklauseln.

## Wie lange

Bis du dein Konto löschst. Dann werden alle oben genannten Daten gelöscht.
Nächtliche Sicherungskopien werden 30 Tage aufbewahrt und danach überschrieben,
weshalb eine Löschung dort bis zu 30 Tage nachläuft.

Die Aufzeichnung darüber, dass und wann du eingewilligt hast, bleibt bestehen,
auch wenn du die Einwilligung zurücknimmst — sie ist der Nachweis, dass die
Verarbeitung rechtmäßig war. Sie enthält keine Gesundheitsdaten.

## Deine Rechte

Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und
Widerspruch. Zwei davon sind direkt in der App:

- **Daten mitnehmen** — lädt alles herunter, was oben aufgezählt ist, als eine
  JSON-Datei.
- **Konto löschen** — löscht es.

Eine erteilte Einwilligung kannst du jederzeit zurücknehmen; die Verarbeitung
bis dahin bleibt rechtmäßig. Du kannst dich außerdem bei einer
Datenschutz-Aufsichtsbehörde beschweren.

## Kinder

Die App ist nicht für Personen unter 16 Jahren gedacht und weist im Onboarding
niemanden an, der noch wächst.

## Änderungen

Ändert sich diese Erklärung inhaltlich, bekommt sie eine neue Fassung und du
wirst erneut um Einwilligung gebeten. Die alte Einwilligung zählt dann nicht
mehr, was der Grund ist, weshalb die Fassung mitgespeichert wird.
