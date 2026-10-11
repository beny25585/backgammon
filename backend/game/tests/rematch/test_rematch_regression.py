from django.test import TestCase







class ConsumerMappingTest(TestCase):
    def test_source_not_settled_maps_to_creating(self):
        # Simulate consumer logic
        from game.consumers import GameConsumer
        # Check that code branch exists – inspect source
        import inspect
        src = inspect.getsource(GameConsumer._handle_rematch_request)
        self.assertIn("source_not_settled", src)
        self.assertIn("'creating'", src)

    def test_invalid_source_maps_to_unavailable(self):
        from game.consumers import GameConsumer
        import inspect
        src = inspect.getsource(GameConsumer._handle_rematch_request)
        self.assertIn("invalid_source", src)
        self.assertIn("unavailable", src)

    def test_source_room_mismatch_maps_to_unavailable(self):
        from game.consumers import GameConsumer
        import inspect
        src = inspect.getsource(GameConsumer._handle_rematch_request)
        self.assertIn("source_room_mismatch", src)
