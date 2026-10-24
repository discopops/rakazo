import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("chief_mail",Path(__file__).with_name("chief_mail.py"))
mail=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mail)

def msg(mid, timestamp, sender="other@example.org", inbox=True):
    return {"id":mid,"internalDate":str(timestamp),"labelIds":(["INBOX"] if inbox else ["SENT"]),
            "snippet":"Please reply","payload":{"mimeType":"text/plain","headers":[
                {"name":"From","value":sender},{"name":"Subject","value":"Hello"}],
                "body":{"data":"UGxlYXNlIHJlcGx5"}}}

def conversation(incoming, outgoing=None):
    return {"id":"thread1","messages":[msg(incoming,1000)] + ([msg(outgoing,2000,"me@example.com",False)] if outgoing else [])}

class Stub:
    expected_email="me@example.com"
    def __init__(self):
        self.messages=conversation("a")
        self.calls=[]
        self.cursor="100"
    def profile(self):
        return {"emailAddress":self.expected_email,"historyId":self.cursor}
    def list_inbox(self):
        self.calls.append("list")
        return {"thread1"}
    def history(self,cursor):
        self.calls.append("history")
        return {"thread1"},"101"
    def thread(self,tid):
        self.calls.append("thread")
        return self.messages

class ChiefTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=mail.database(Path(self.tmp.name)/"test.db")
        self.gmail=Stub()
        self.seen=[]
        self.classifier=lambda m:self.seen.append(m["id"]) or ("needs_reply",0.99)
    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()
    def test_baseline_then_repeat_and_owner_reply(self):
        r=mail.run_sync(self.db,self.gmail,self.classifier)
        self.assertEqual(r["classified"],1)
        self.assertEqual(self.seen,["a"])
        r=mail.run_sync(self.db,self.gmail,self.classifier)
        self.assertEqual(r["classified"],0)
        self.gmail.messages=conversation("a","owner-sent")
        r=mail.run_sync(self.db,self.gmail,self.classifier)
        self.assertEqual(r["owner_answered"],1)
        self.assertEqual(self.seen,["a"])
        self.assertEqual(mail.briefing(self.db)["pending"],[])
        self.gmail.messages={"id":"thread1","messages":[msg("a",1000),msg("owner-sent",2000,"me@example.com",False),msg("new",3000)]}
        r=mail.run_sync(self.db,self.gmail,self.classifier)
        self.assertEqual(r["classified"],1)
        self.assertEqual(self.seen,["a","new"])
        self.assertEqual(mail.briefing(self.db)["pending"][0]["status"],"needs_reply")
    def test_inbox_pagination_reads_every_page(self):
        gmail = mail.Gmail.__new__(mail.Gmail)
        pages = []
        def get(path, args):
            pages.append((path, dict(args)))
            if "pageToken" not in args:
                return {"threads": [{"id": "first"}], "nextPageToken": "next"}
            return {"threads": [{"id": "second"}]}
        gmail.get = get
        self.assertEqual(gmail.list_inbox(), {"first", "second"})
        self.assertEqual(pages[0][0], "/threads")
        self.assertEqual(pages[1][1]["pageToken"], "next")
    def test_gmail_history_pagination_includes_all_changes(self):
        gmail = mail.Gmail.__new__(mail.Gmail)
        def get(path, args):
            if "pageToken" not in args:
                return {"historyId": "110", "history": [
                    {"messagesAdded": [{"message": {"threadId": "incoming"}}]}],
                    "nextPageToken": "next"}
            return {"historyId": "110", "history": [
                {"messages": [{"threadId": "outgoing"}]},
                {"labelsRemoved": [{"message": {"threadId": "archived"}}]}]}
        gmail.get = get
        changed, latest = gmail.history("100")
        self.assertEqual(changed, {"incoming", "outgoing", "archived"})
        self.assertEqual(latest, "110")
    def test_unchanging_cursor_rejected(self):
        gmail = mail.Gmail.__new__(mail.Gmail)
        gmail.get = lambda path, args: {"threads": [], "nextPageToken": "loop"}
        with self.assertRaisesRegex(RuntimeError, "repeated a cursor"):
            gmail.list_inbox()
    def test_history_only_changes_do_not_reclassify_sent_mail(self):
        mail.run_sync(self.db, self.gmail, self.classifier)
        self.gmail.messages = conversation("a", "owner-sent")
        mail.run_sync(self.db, self.gmail, self.classifier)
        self.assertEqual(self.seen, ["a"])
        mail.run_sync(self.db, self.gmail, self.classifier)
        self.assertEqual(self.seen, ["a"])
    def test_spoofed_sender_is_not_treated_as_sent(self):
        suspect = msg("fake", 123, sender="me@example.com")
        rev = mail.thread_revision({"id": "thread", "messages": [suspect]}, "me@example.com")
        self.assertFalse(rev["inbound"] is None)
        self.assertIsNone(rev["outbound"])
    def test_voice_status_deferred_until_due_and_revision_guard(self):
        from datetime import datetime, timedelta, timezone
        mail.run_sync(self.db, self.gmail, self.classifier)
        self.assertEqual(len(mail.briefing(self.db)["pending"]), 1)
        deadline=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()
        mail.update_status(self.db, "thread1", "a", "deferred", deadline)
        self.assertEqual(mail.briefing(self.db)["pending"], [])
        mail.run_sync(self.db, self.gmail, self.classifier, force_full=True)
        self.assertEqual(mail.briefing(self.db)["pending"], [])
        self.assertEqual(self.db.execute("SELECT status FROM threads WHERE thread_id='thread1'").fetchone()[0], "deferred")
        with self.assertRaisesRegex(RuntimeError, "changed or not indexed"):
            mail.update_status(self.db, "thread1", "stale-revision", "handled")
        self.gmail.messages={"id":"thread1","messages":[msg("a",1000),msg("b",3000)]}
        mail.run_sync(self.db, self.gmail, self.classifier)
        self.assertEqual(len(mail.briefing(self.db)["pending"]), 1)
        self.assertEqual(self.seen, ["a", "b"])
    def test_voice_mark_handled_preserved_on_rescan(self):
        mail.run_sync(self.db, self.gmail, self.classifier)
        mail.update_status(self.db, "thread1", "a", "handled")
        self.assertEqual(mail.briefing(self.db)["pending"], [])
        mail.run_sync(self.db, self.gmail, self.classifier, force_full=True)
        self.assertEqual(mail.briefing(self.db)["pending"], [])
        self.assertEqual(self.seen, ["a"])
    def test_refuse_mark_handled_without_matching_revision(self):
        mail.run_sync(self.db, self.gmail, self.classifier)
        with self.assertRaises(ValueError):
            mail.update_status(self.db, "thread1", "a", "sent")
        with self.assertRaises(ValueError):
            mail.update_status(self.db, "thread1", "a", "deferred", "2020-01-01T00:00:00+00:00")
        self.assertEqual(mail.briefing(self.db)["pending"][0]["status"], "needs_reply")
    def test_attachment_notice_cannot_be_dismissed_as_noise(self):
        original_request = mail.request_json
        original_key = mail.require
        try:
            mail.request_json = lambda *args, **kwargs: {
                "answers": {"decision": {"choice": "noise", "confidence": 0.99}}}
            mail.require = lambda key: "test-not-a-key"
            document = {"from": "school@example.org", "subject": "Reminder notice",
                "snippet": "Please see attached", "body": "Please see attached",
                "attachments": ["overdue-invoice.pdf"]}
            self.assertEqual(mail.classify_jev(document), ("uncertain", 0.99))
            document["attachments"] = []
            self.assertEqual(mail.classify_jev(document), ("noise", 0.99))
        finally:
            mail.request_json = original_request
            mail.require = original_key

    def test_attachment_filenames_are_preserved_in_revision(self):
        message = msg("a", 1000)
        message["payload"]["parts"] = [{
            "mimeType": "application/pdf", "filename": "invoice.pdf",
            "body": {"attachmentId": "not-fetched"}
        }]
        rev = mail.thread_revision({"id": "t", "messages": [message]}, "me@example.com")
        self.assertEqual(rev["inbound"]["attachments"], ["invoice.pdf"])

    def test_untrusted_message_not_commands(self):
        self.assertEqual(mail.decode_part("UGxlYXNlIHJlcGx5"),"Please reply")
        self.assertEqual(mail.header(msg("a",123),"Subject"),"Hello")
    def test_sent_requires_actual_gmail_confirmation(self):
        mail.run_sync(self.db,self.gmail,self.classifier)
        with self.assertRaisesRegex(RuntimeError,"not confirmed"):
            mail.reconcile_sent(self.db,self.gmail,"thread1","fabricated-id")
        self.assertEqual(mail.briefing(self.db)["pending"][0]["status"],"needs_reply")
    def test_history_expiry_falls_back_to_complete_scan(self):
        mail.run_sync(self.db,self.gmail,self.classifier)
        def stale(_):raise KeyError("expired")
        self.gmail.history=stale
        result=mail.run_sync(self.db,self.gmail,self.classifier)
        self.assertEqual(result["scan"],"full")
        self.assertEqual(self.seen,["a"])

if __name__=="__main__":
    unittest.main()
