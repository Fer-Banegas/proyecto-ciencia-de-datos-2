class DatasetError(Exception):
    """Error controlado al leer o validar el conjunto de datos."""

    def __init__(self, message: str, code: str = "DATASET_ERROR") -> None:
        super().__init__(message)
        self.message = message
        self.code = code

